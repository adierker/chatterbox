import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import { StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type ChatterboxPlugin from './main';
import { ChatPanel } from './ui/ChatPanel';
import { ObsidianProvider } from './ui/ObsidianContext';

export const CHATTERBOX_VIEW_TYPE = 'chatterbox-panel';

/** What the panel lets commands outside React do (SPEC §4.4: keyboard access). */
export interface PanelActions {
	openChat: (file: TFile) => void;
	editLastMessage: () => boolean;
	regenerateLastReply: () => boolean;
	generateTitle: () => boolean;
	stop: () => boolean;
	newChat: () => void;
}

export class ChatterboxView extends ItemView {
	private readonly plugin: ChatterboxPlugin;
	private root: Root | null = null;
	/** Set by the panel once mounted, so commands can drive it. */
	private actions: PanelActions | null = null;
	/**
	 * A chat requested before the panel finished mounting. React renders the
	 * panel asynchronously, so a command that opens the view and immediately
	 * asks it to load a chat would otherwise arrive before anyone is listening.
	 */
	private pendingChat: TFile | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ChatterboxPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = false;
	}

	getViewType(): string {
		return CHATTERBOX_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Chatterbox';
	}

	getIcon(): string {
		return 'message-square';
	}

	registerActions(actions: PanelActions): void {
		this.actions = actions;

		const queued = this.pendingChat;
		if (queued) {
			this.pendingChat = null;
			actions.openChat(queued);
		}
	}

	openChat(file: TFile): void {
		if (this.actions) {
			this.actions.openChat(file);
		} else {
			this.pendingChat = file;
		}
	}

	/** Null until the panel has mounted. */
	panelActions(): PanelActions | null {
		return this.actions;
	}

	protected onOpen(): Promise<void> {
		// On mobile the sidebar drawer closes on a horizontal swipe, which
		// takes over any touch that begins in the panel and so makes text
		// impossible to select. Obsidian's own opt-out: its touchstart handler
		// walks up from the touched element and abandons the gesture on the
		// first ancestor carrying this attribute. The markdown editor sets it
		// for exactly this reason, which is why notes are selectable and this
		// panel was not.
		this.contentEl.dataset.ignoreSwipe = 'true';

		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<ObsidianProvider value={{ app: this.app, component: this }}>
					<ChatPanel plugin={this.plugin} view={this} />
				</ObsidianProvider>
			</StrictMode>,
		);
		return Promise.resolve();
	}

	protected onClose(): Promise<void> {
		this.actions = null;
		this.root?.unmount();
		this.root = null;
		return Promise.resolve();
	}
}
