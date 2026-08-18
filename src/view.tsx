import { ItemView, Platform, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
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
	/**
	 * Close button added to the drawer's own tab bar on mobile. It lives in
	 * Obsidian's chrome rather than in this view, so it has to be put back
	 * whenever the leaf moves and taken away when the view closes.
	 */
	private drawerCloseEl: HTMLElement | null = null;

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

	/** The drawer this leaf sits in, or null anywhere else. */
	private drawer(): { collapse: () => void } | null {
		const root = this.leaf.getRoot();
		const { leftSplit, rightSplit } = this.app.workspace;
		if (root === rightSplit) return rightSplit;
		if (root === leftSplit) return leftSplit;
		return null;
	}

	/**
	 * Puts a back button at the left of the drawer's tab bar. Without it a
	 * phone has no way out of this panel: the drawer covers the whole screen,
	 * so its backdrop cannot be tapped, and the panel opts out of the swipe
	 * that would otherwise close it (see onOpen).
	 */
	private syncDrawerCloseButton(): void {
		this.drawerCloseEl?.remove();
		this.drawerCloseEl = null;
		if (!Platform.isMobile) return;

		const drawer = this.drawer();
		const tabOptions = this.containerEl
			.closest('.workspace-drawer')
			?.querySelector('.workspace-drawer-tab-options');
		if (!drawer || !tabOptions) return;

		const button = createDiv('clickable-icon chatterbox-drawer-close');
		setIcon(button, 'chevron-left');
		button.setAttr('aria-label', 'Close panel');
		button.addEventListener('click', () => {
			drawer.collapse();
		});

		tabOptions.prepend(button);
		this.drawerCloseEl = button;
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

		// Also re-run on layout change: the button belongs to whichever drawer
		// currently holds this leaf, so moving between sidebars, a tab, or a
		// pop-out window has to move or drop it.
		this.syncDrawerCloseButton();
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.syncDrawerCloseButton();
			}),
		);

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
		this.drawerCloseEl?.remove();
		this.drawerCloseEl = null;
		this.actions = null;
		this.root?.unmount();
		this.root = null;
		return Promise.resolve();
	}
}
