import { App, FuzzySuggestModal, FuzzyMatch, TFile } from 'obsidian';
import { isChatFile } from './chatFile';

/**
 * Fallback to drag and drop (SPEC §4.2): fuzzy search over every markdown
 * file in the vault. Opened from the attach button or by typing @.
 */
export class FilePickerModal extends FuzzySuggestModal<TFile> {
	private readonly onPick: (file: TFile) => void;
	private readonly attached: ReadonlySet<string>;
	private readonly chatFolder: string;

	constructor(
		app: App,
		attached: ReadonlySet<string>,
		chatFolder: string,
		onPick: (file: TFile) => void,
	) {
		super(app);
		this.attached = attached;
		this.chatFolder = chatFolder;
		this.onPick = onPick;
		this.setPlaceholder('Attach a note');
		// The default caps the list, which silently hides notes in a large
		// vault. Matching is fuzzy over the whole path, so a long list is fine.
		this.limit = 500;
	}

	getItems(): TFile[] {
		// Everything, including what is already attached: a picker that hides
		// files reads as a picker that is missing them. Transcripts are the one
		// exception — the chat folder would swamp the list as it grows. Drag
		// and drop stays unfiltered for attaching one deliberately.
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => !isChatFile(file, this.chatFolder));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		super.renderSuggestion(match, el);

		if (this.attached.has(match.item.path)) {
			el.addClass('chatterbox-suggestion-attached');
			el.createSpan({
				cls: 'chatterbox-suggestion-note',
				text: 'attached',
			});
		}
	}

	onChooseItem(file: TFile): void {
		// Attaching twice is a no-op, so choosing one that is already attached
		// simply closes the picker.
		this.onPick(file);
	}
}
