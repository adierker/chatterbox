import { App, EventRef, Modal, TFile, debounce, setIcon } from 'obsidian';
import { ChatSummary, deleteChat, listChats } from './chatFile';

/**
 * History browser (SPEC §4.5): every saved chat, most recent first, filterable
 * by title, with fork parentage shown and deletion through the trash.
 */
export class HistoryModal extends Modal {
	private readonly folder: string;
	private readonly onOpenChat: (file: TFile) => void;
	private filter = '';
	private listEl!: HTMLElement;
	/** Vault subscriptions, released on close. Modal is not a Component, so
	 *  there is no registerEvent to do it automatically. */
	private watchers: EventRef[] = [];

	constructor(
		app: App,
		folder: string,
		onOpenChat: (file: TFile) => void,
	) {
		super(app);
		this.folder = folder;
		this.onOpenChat = onOpenChat;
	}

	onOpen(): void {
		this.titleEl.setText('Chat history');

		const search = this.contentEl.createEl('input', {
			type: 'search',
			cls: 'chatterbox-history-search',
			attr: { placeholder: 'Filter by title' },
		});
		search.addEventListener('input', () => {
			this.filter = search.value.toLowerCase();
			this.renderList();
		});

		this.listEl = this.contentEl.createDiv('chatterbox-history-list');
		this.renderList();
		search.focus();

		// The list was built once and then went stale. Sync can land a chat
		// seconds after this opens — on another device's schedule, not the
		// reader's — and without this it stays invisible until the modal is
		// closed and reopened, which reads as the chat having been lost.
		//
		// Debounced because a sync arrives as a burst, and each render rebuilds
		// every row. Only membership changes are watched: `modify` fires for
		// every save of the chat being streamed into right now.
		const refresh = debounce(() => {
			this.renderList();
		}, 300);
		this.watchers.push(
			this.app.vault.on('create', refresh),
			this.app.vault.on('delete', refresh),
			this.app.vault.on('rename', refresh),
		);
	}

	onClose(): void {
		for (const watcher of this.watchers) this.app.vault.offref(watcher);
		this.watchers = [];
		this.contentEl.empty();
	}

	private renderList(): void {
		this.listEl.empty();

		const chats = listChats(this.app, this.folder).filter((chat) =>
			chat.title.toLowerCase().includes(this.filter),
		);

		if (chats.length === 0) {
			this.listEl.createDiv({
				cls: 'chatterbox-history-empty',
				text:
					this.filter === ''
						? 'No saved chats yet.'
						: 'No chats match that filter.',
			});
			return;
		}

		for (const chat of chats) this.renderRow(chat);
	}

	private renderRow(chat: ChatSummary): void {
		const row = this.listEl.createDiv('chatterbox-history-row');

		const main = row.createDiv('chatterbox-history-main');
		main.createDiv({ cls: 'chatterbox-history-title', text: chat.title });

		const subtitle = main.createDiv('chatterbox-history-meta');
		subtitle.setText(new Date(chat.modified).toLocaleString());

		if (chat.forkedFrom !== null) {
			const parentName =
				chat.forkedFrom.split('/').pop()?.replace(/\.md$/, '') ??
				chat.forkedFrom;
			const link = subtitle.createEl('a', {
				cls: 'chatterbox-history-parent',
				text: ` · fork of ${parentName}`,
				href: '#',
			});
			link.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.openParent(chat.forkedFrom);
			});
		}

		main.addEventListener('click', () => {
			this.onOpenChat(chat.file);
			this.close();
		});

		const remove = row.createEl('button', {
			cls: 'chatterbox-history-delete',
			attr: { 'aria-label': `Delete ${chat.title}` },
		});
		setIcon(remove, 'trash-2');
		remove.addEventListener('click', (event) => {
			event.stopPropagation();
			void this.confirmDelete(chat);
		});
	}

	private openParent(path: string | null): void {
		if (path === null) return;
		const parent = this.app.vault.getAbstractFileByPath(path);
		if (parent instanceof TFile) {
			this.onOpenChat(parent);
			this.close();
		}
	}

	private async confirmDelete(chat: ChatSummary): Promise<void> {
		await deleteChat(this.app, chat.file);
		this.renderList();
	}
}
