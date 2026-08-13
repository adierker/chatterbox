import { App, Modal, Setting } from 'obsidian';

/** Yes/no confirmation for an action with a consequence worth stating. */
export class ConfirmModal extends Modal {
	private readonly heading: string;
	private readonly body: string;
	private readonly cta: string;
	private readonly onConfirm: () => void;

	constructor(
		app: App,
		heading: string,
		body: string,
		cta: string,
		onConfirm: () => void,
	) {
		super(app);
		this.heading = heading;
		this.body = body;
		this.cta = cta;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.createEl('p', { text: this.body });

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(this.cta)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
