import { App, Modal, Setting } from 'obsidian';

/** Small text prompt — Obsidian has no built-in equivalent. */
export class PromptModal extends Modal {
	private value: string;
	private readonly heading: string;
	private readonly cta: string;
	private readonly onSubmit: (value: string) => void;

	constructor(
		app: App,
		heading: string,
		initial: string,
		cta: string,
		onSubmit: (value: string) => void,
	) {
		super(app);
		this.heading = heading;
		this.value = initial;
		this.cta = cta;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);

		const setting = new Setting(this.contentEl).addText((text) => {
			text.setValue(this.value).onChange((value) => {
				this.value = value;
			});
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					this.submit();
				}
			});
			window.setTimeout(() => {
				text.inputEl.select();
			}, 0);
		});
		setting.settingEl.addClass('chatterbox-prompt-row');

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText(this.cta)
				.setCta()
				.onClick(() => {
					this.submit();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const trimmed = this.value.trim();
		if (trimmed === '') return;
		this.close();
		this.onSubmit(trimmed);
	}
}
