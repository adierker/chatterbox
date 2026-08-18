import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import {
	ChatterboxSettings,
	ChatterboxSettingTab,
	DEFAULT_SETTINGS,
	loadApiKey,
} from './settings';
import { CHATTERBOX_VIEW_TYPE, ChatterboxView, PanelActions } from './view';
import { ChatMessage } from './types';
import { streamCompletion } from './openrouter';
import { renameChat } from './chatFile';
import { HistoryModal } from './historyModal';
import { PromptModal } from './promptModal';
import { UNTITLED, sanitizeTitle } from './titles';

/** Sidebar, a tab in the main area, or its own OS window. */
export type PanelPlacement = 'sidebar' | 'tab' | 'window';

const TITLE_INSTRUCTION =
	'Give this conversation a short title: at most six words, no quotes, no trailing punctuation. Reply with the title alone.';

/** Per message, so one long reply cannot crowd out the opening prompt. */
const TITLE_EXCERPT_LIMIT = 2000;

export default class ChatterboxPlugin extends Plugin {
	settings: ChatterboxSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			CHATTERBOX_VIEW_TYPE,
			(leaf) => new ChatterboxView(leaf, this),
		);

		this.addRibbonIcon('message-square', 'Chatterbox', () => {
			void this.openPanel();
		});

		this.addCommand({
			id: 'open-panel',
			name: 'Open panel',
			callback: () => {
				void this.openPanel();
			},
		});

		this.addCommand({
			id: 'open-in-tab',
			name: 'Open in the main area',
			callback: () => {
				void this.openPanel('tab');
			},
		});

		this.addCommand({
			id: 'open-in-window',
			name: 'Open in a separate window',
			callback: () => {
				void this.openPanel('window');
			},
		});

		this.addCommand({
			id: 'open-history',
			name: 'Browse chat history',
			callback: () => {
				new HistoryModal(this.app, this.settings.chatFolder, (file) => {
					void this.openPanel().then(() => this.revealChat(file));
				}).open();
			},
		});

		// Keyboard routes to the panel's affordances (SPEC §4.4). Each is a
		// checkCallback so it only appears when it can actually do something.
		this.addPanelCommand('stop-generating', 'Stop generating', (actions) =>
			actions.stop(),
		);
		this.addPanelCommand(
			'edit-last-message',
			'Edit my last message',
			(actions) => actions.editLastMessage(),
		);
		this.addPanelCommand(
			'regenerate-last-reply',
			'Regenerate the last reply',
			(actions) => actions.regenerateLastReply(),
		);
		this.addPanelCommand(
			'generate-title',
			'Generate a title for this chat',
			(actions) => actions.generateTitle(),
		);
		this.addPanelCommand('new-chat', 'New chat', (actions) => {
			actions.newChat();
			return true;
		});

		this.addCommand({
			id: 'rename-chat',
			name: 'Rename the active chat',
			checkCallback: (checking: boolean) => {
				const file = this.activeChatFile();
				if (!file) return false;
				if (!checking) this.promptRename(file);
				return true;
			},
		});

		// Keep the restore pointer correct when a chat is renamed or moved.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (oldPath === this.settings.lastActiveChat) {
					void this.rememberActiveChat(file.path);
				}
			}),
		);

		this.addSettingTab(new ChatterboxSettingTab(this.app, this));
	}

	/** Where the panel lives. Sidebar is the default (SPEC §4.1). */
	private placementOf(leaf: WorkspaceLeaf): PanelPlacement {
		const root = leaf.getRoot();
		const { leftSplit, rightSplit, rootSplit } = this.app.workspace;

		if (root === leftSplit || root === rightSplit) return 'sidebar';
		if (root === rootSplit) return 'tab';
		return 'window';
	}

	/** Where the open panel currently is, or null if it is not open. */
	panelPlacement(): PanelPlacement | null {
		const leaf =
			this.app.workspace.getLeavesOfType(CHATTERBOX_VIEW_TYPE)[0] ?? null;
		return leaf ? this.placementOf(leaf) : null;
	}

	/**
	 * Opens the chat, or moves it if it is already open somewhere else. Only
	 * ever one panel exists: a second would be a second conversation writing to
	 * the same active-chat pointer and the same folder.
	 *
	 * Moving detaches and recreates, so the view remounts. The conversation
	 * comes back because it is a file and the active chat is restored on mount;
	 * an unsaved draft in the composer does not.
	 */
	async openPanel(placement: PanelPlacement = 'sidebar'): Promise<void> {
		const { workspace } = this.app;
		const existing =
			workspace.getLeavesOfType(CHATTERBOX_VIEW_TYPE)[0] ?? null;

		if (existing && this.placementOf(existing) === placement) {
			await workspace.revealLeaf(existing);
			return;
		}

		existing?.detach();

		const leaf: WorkspaceLeaf | null =
			placement === 'sidebar'
				? workspace.getRightLeaf(false)
				: workspace.getLeaf(placement === 'window' ? 'window' : 'tab');

		await leaf?.setViewState({ type: CHATTERBOX_VIEW_TYPE, active: true });
		if (leaf) await workspace.revealLeaf(leaf);
	}

	/**
	 * Registers a command that acts on the open panel. The action reports
	 * whether it applies, so the command stays out of the palette when it
	 * would do nothing.
	 */
	private addPanelCommand(
		id: string,
		name: string,
		run: (actions: PanelActions) => boolean,
	): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking: boolean) => {
				const actions = this.panelActions();
				if (!actions) return false;
				if (checking) return true;
				return run(actions);
			},
		});
	}

	private panelActions(): PanelActions | null {
		for (const leaf of this.app.workspace.getLeavesOfType(
			CHATTERBOX_VIEW_TYPE,
		)) {
			if (leaf.view instanceof ChatterboxView) {
				return leaf.view.panelActions();
			}
		}
		return null;
	}

	/** Asks the open panel, if any, to load a chat. */
	private revealChat(file: TFile): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			CHATTERBOX_VIEW_TYPE,
		)) {
			const view = leaf.view;
			if (view instanceof ChatterboxView) {
				view.openChat(file);
				return;
			}
		}
	}

	private activeChatFile(): TFile | null {
		if (this.settings.lastActiveChat === '') return null;
		const file = this.app.vault.getAbstractFileByPath(
			this.settings.lastActiveChat,
		);
		return file instanceof TFile ? file : null;
	}

	private promptRename(file: TFile): void {
		new PromptModal(
			this.app,
			'Rename chat',
			file.basename,
			'Rename',
			(title) => {
				void renameChat(this.app, file, sanitizeTitle(title)).catch(
					(error: unknown) => {
						new Notice(
							`Chatterbox: rename failed — ${error instanceof Error ? error.message : String(error)}`,
						);
					},
				);
			},
		).open();
	}

	async rememberActiveChat(path: string | null): Promise<void> {
		const next = path ?? '';
		if (this.settings.lastActiveChat === next) return;
		this.settings.lastActiveChat = next;
		await this.saveSettings();
	}

	/**
	 * Asks the model for a title. Opt-in only (SPEC §4.5) and best-effort:
	 * returns null rather than throwing, since a title is never worth
	 * interrupting a conversation over.
	 */
	async generateTitle(messages: readonly ChatMessage[]): Promise<string | null> {
		const apiKey = loadApiKey(this.app, this.settings);
		if (apiKey === '') return null;

		// The conversation keeps its real turns, and the instruction arrives as
		// the last user message. Flattening it all into one user turn instead
		// reads as a request to write the prose rather than to label it, which
		// draws refusals on material the conversation itself produced happily.
		const request: ChatMessage[] = [
			...messages.map((message) => ({
				...message,
				content: message.content.slice(0, TITLE_EXCERPT_LIMIT),
			})),
			{ id: 'title', role: 'user', content: TITLE_INSTRUCTION },
		];

		let title = '';
		for await (const delta of streamCompletion({
			apiKey,
			model: this.defaultModel(),
			messages: request,
			system: null,
		})) {
			title += delta;
		}

		const cleaned = sanitizeTitle(
			title.trim().replace(/^["']|["']$/g, '').split('\n')[0] ?? '',
		);
		return cleaned === UNTITLED ? null : cleaned;
	}

	/** Falls back to the first configured model if the default was removed. */
	defaultModel(): string {
		const { models, defaultModel } = this.settings;
		if (models.includes(defaultModel)) return defaultModel;
		return models[0] ?? DEFAULT_SETTINGS.defaultModel;
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<ChatterboxSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...stored };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
