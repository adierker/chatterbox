import { App, Notice, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import type ChatterboxPlugin from './main';
import { ChatParameters, ReasoningEffort } from './types';
import {
	ALL_EFFORTS,
	EffortOptions,
	parseEffortOptions,
	serializeEffortOptions,
	validateParameters,
} from './parameters';

export interface ChatterboxSettings {
	/**
	 * Fallback key storage for Obsidian versions without `secretStorage`
	 * (added in 1.11.4). Empty whenever secretStorage is doing the job.
	 */
	apiKey: string;
	/** Hand-maintained list of OpenRouter model slugs. No discovery, by design. */
	models: string[];
	defaultModel: string;
	/** Seeds a new chat's prompt. Each chat then carries its own (SPEC §4.3). */
	systemPrompt: string;
	/** Folder holding chat transcripts. */
	chatFolder: string;
	/** Opt-in by design (SPEC §4.5): never retitle a chat unasked. */
	autoGenerateTitles: boolean;
	/** Which keystroke sends; the other one inserts a newline (SPEC §6). */
	sendShortcut: 'enter' | 'mod-enter';
	/** Internal: the chat to restore when the panel reopens. */
	lastActiveChat: string;
	/** Starting parameters for a new chat (SPEC §4.6). */
	defaultParameters: ChatParameters;
	/** Which reasoning efforts each model accepts. Not published by OpenRouter. */
	effortOptions: EffortOptions;
}

export const DEFAULT_SETTINGS: ChatterboxSettings = {
	apiKey: '',
	models: ['z-ai/glm-5.2', 'moonshotai/kimi-k3'],
	defaultModel: 'z-ai/glm-5.2',
	systemPrompt: '',
	chatFolder: 'X - Chatterbox',
	autoGenerateTitles: false,
	sendShortcut: 'enter',
	lastActiveChat: '',
	// Top P is deliberately unset: unset means omitted, not defaulted.
	defaultParameters: {
		temperature: 0.7,
		maxTokens: 4096,
	},
	effortOptions: {
		'z-ai/glm-5.2': ['high', 'xhigh'],
		'moonshotai/kimi-k3': ['low', 'high', 'max'],
	},
};

const SECRET_ID = 'chatterbox-openrouter-key';

/**
 * `app.secretStorage` arrived in Obsidian 1.11.4. The type declares it as
 * always present, so this reads through a widened type and checks at runtime:
 * SPEC §4.3 asks for secret storage where available and data.json otherwise,
 * which means minAppVersion stays below 1.11.4 on purpose.
 */
type MaybeSecretStorage = { secretStorage?: App['secretStorage'] };

function secretStore(app: App): App['secretStorage'] | undefined {
	return (app as MaybeSecretStorage).secretStorage;
}

export function loadApiKey(app: App, settings: ChatterboxSettings): string {
	const store = secretStore(app);
	if (store) {
		return store.getSecret(SECRET_ID) ?? settings.apiKey;
	}
	return settings.apiKey;
}

/**
 * Writes the key to secretStorage when available, and clears the data.json
 * copy so the key does not linger in plain text after an Obsidian upgrade.
 */
export async function storeApiKey(
	plugin: ChatterboxPlugin,
	key: string,
): Promise<void> {
	const store = secretStore(plugin.app);
	if (store) {
		store.setSecret(SECRET_ID, key);
		plugin.settings.apiKey = '';
	} else {
		plugin.settings.apiKey = key;
	}
	await plugin.saveSettings();
}

export class ChatterboxSettingTab extends PluginSettingTab {
	private readonly plugin: ChatterboxPlugin;

	constructor(app: App, plugin: ChatterboxPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** A number field where blank means "omit from the request". */
	private numberSetting(
		containerEl: HTMLElement,
		name: string,
		description: string,
		key: 'temperature' | 'topP' | 'maxTokens',
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addText((text) => {
				const current = this.plugin.settings.defaultParameters[key];
				text.setPlaceholder('unset')
					.setValue(current === undefined ? '' : String(current))
					.onChange(async (value) => {
						const parameters =
							this.plugin.settings.defaultParameters;
						const trimmed = value.trim();

						if (trimmed === '') {
							delete parameters[key];
						} else {
							const parsed = Number(trimmed);
							if (!Number.isFinite(parsed)) return;
							parameters[key] = parsed;
						}

						const issues = validateParameters(parameters);
						const issue = issues.find(
							(candidate) => candidate.field === key,
						);
						if (issue) {
							new Notice(`Chatterbox: ${issue.message}`);
							return;
						}

						await this.plugin.saveSettings();
					});
			});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const usingSecretStorage = secretStore(this.app) !== undefined;

		new Setting(containerEl)
			.setName('OpenRouter API key')
			.setDesc(
				usingSecretStorage
					? "Stored in Obsidian's secret storage."
					: "Stored in this plugin's data.json — your Obsidian is older than 1.11.4, which is when secret storage arrived.",
			)
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder('sk-or-v1-…')
					.setValue(loadApiKey(this.app, this.plugin.settings))
					.onChange(async (value) => {
						await storeApiKey(this.plugin, value.trim());
					});
			});

		new Setting(containerEl)
			.setName('Models')
			.setDesc(
				'OpenRouter model slugs, one per line. Maintained by hand — see openrouter.ai/models.',
			)
			.addTextArea((area) => {
				area.inputEl.rows = 6;
				area.setValue(this.plugin.settings.models.join('\n')).onChange(
					async (value) => {
						this.plugin.settings.models = value
							.split('\n')
							.map((line) => line.trim())
							.filter((line) => line.length > 0);
						await this.plugin.saveSettings();
					},
				);
				area.inputEl.addEventListener('blur', () => {
					// Redraw so the default-model dropdown picks up list edits.
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('System prompt')
			.setDesc(
				'Starting point for new chats, sent ahead of any attached notes. Each chat keeps its own copy, editable from the panel.',
			)
			.addTextArea((area) => {
				area.inputEl.rows = 8;
				area.setPlaceholder(
					'Standing instructions for every new chat…',
				)
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Defaults for new chats')
			.setDesc(
				'New chats start from these. Leave a field blank to omit it from requests entirely rather than send a default — some models reject parameters they do not support. Support varies by model.',
			)
			.setHeading();

		this.numberSetting(
			containerEl,
			'Temperature',
			'0 to 2.',
			'temperature',
		);
		this.numberSetting(
			containerEl,
			'Top P',
			'Above 0, up to 1. Blank by default.',
			'topP',
		);
		this.numberSetting(
			containerEl,
			'Token limit',
			'Maximum tokens in the reply.',
			'maxTokens',
		);

		new Setting(containerEl)
			.setName('Reasoning')
			.setDesc(
				'Model default sends nothing and lets the provider decide. Off disables reasoning explicitly, which is not the same thing.',
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption('default', 'Model default')
					.addOption('on', 'On')
					.addOption('off', 'Off');

				const current = this.plugin.settings.defaultParameters.reasoning;
				dropdown.setValue(
					current === undefined ? 'default' : current ? 'on' : 'off',
				);
				dropdown.onChange(async (value) => {
					const parameters = this.plugin.settings.defaultParameters;
					if (value === 'default') delete parameters.reasoning;
					else parameters.reasoning = value === 'on';
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Reasoning effort')
			.setDesc('Used when reasoning is on. Blank leaves it to the provider.')
			.addDropdown((dropdown) => {
				dropdown.addOption('', 'Provider default');
				for (const effort of ALL_EFFORTS) {
					dropdown.addOption(effort, effort);
				}
				dropdown.setValue(
					this.plugin.settings.defaultParameters.reasoningEffort ?? '',
				);
				dropdown.onChange(async (value) => {
					const parameters = this.plugin.settings.defaultParameters;
					if (value === '') delete parameters.reasoningEffort;
					else parameters.reasoningEffort = value as ReasoningEffort;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Reasoning efforts per model')
			.setDesc(
				'OpenRouter does not publish which effort levels each model accepts, so list them here: one "model = effort, effort" line per model. Models not listed offer every level. Available: minimal, low, medium, high, xhigh, max.',
			)
			.addTextArea((area) => {
				area.inputEl.rows = 4;
				area.setValue(
					serializeEffortOptions(this.plugin.settings.effortOptions),
				).onChange(async (value) => {
					this.plugin.settings.effortOptions =
						parseEffortOptions(value);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Send with')
			.setDesc('The other combination inserts a newline.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('enter', 'Enter')
					.addOption('mod-enter', 'Cmd/Ctrl + Enter')
					.setValue(this.plugin.settings.sendShortcut)
					.onChange(async (value) => {
						this.plugin.settings.sendShortcut =
							value === 'mod-enter' ? 'mod-enter' : 'enter';
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Chat folder')
			.setDesc('Where transcripts are saved, relative to the vault root.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.chatFolder)
					.setValue(this.plugin.settings.chatFolder)
					.onChange(async (value) => {
						const trimmed = value.trim().replace(/\/+$/, '');
						this.plugin.settings.chatFolder =
							trimmed === ''
								? DEFAULT_SETTINGS.chatFolder
								: normalizePath(trimmed);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Generate titles with the model')
			.setDesc(
				'Off by default. When on, a new chat is retitled from its first exchange.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoGenerateTitles)
					.onChange(async (value) => {
						this.plugin.settings.autoGenerateTitles = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Default model')
			.setDesc('Used for new chats.')
			.addDropdown((dropdown) => {
				for (const model of this.plugin.settings.models) {
					dropdown.addOption(model, model);
				}
				dropdown
					.setValue(this.plugin.defaultModel())
					.onChange(async (value) => {
						this.plugin.settings.defaultModel = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
