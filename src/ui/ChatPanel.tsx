import { DragEvent, useCallback, useEffect, useState } from 'react';
import { Notice, Platform, TFile } from 'obsidian';
import type ChatterboxPlugin from '../main';
import type { ChatterboxView } from '../view';
import { FilePickerModal } from '../filePicker';
import { HistoryModal } from '../historyModal';
import { resolveDrop } from '../vault';
import { useSession } from './useSession';
import { ControlBar, Drawer } from './ControlBar';
import { Icon } from './Icon';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

interface ChatPanelProps {
	plugin: ChatterboxPlugin;
	view: ChatterboxView;
}

export function ChatPanel({ plugin, view }: ChatPanelProps) {
	const session = useSession(plugin);
	const { context } = session;
	const [dragging, setDragging] = useState(false);
	const [drawer, setDrawer] = useState<Drawer>(null);
	const inWindow = plugin.panelPlacement() === 'window';
	const [editingId, setEditingId] = useState<string | null>(null);
	const streaming = session.streamingId !== null;

	// Typing is the main event; an open drawer gets out of the way for it.
	const closeDrawers = useCallback(() => {
		setDrawer(null);
	}, []);

	/**
	 * Switching conversations resets the panel's transient state. A drawer left
	 * open from the previous chat would otherwise carry over and read as though
	 * loading had sprung it open.
	 */
	const loadChat = useCallback(
		(file: TFile) => {
			closeDrawers();
			setEditingId(null);
			void session.open(file);
		},
		[closeDrawers, session],
	);

	// Lets commands outside React drive this panel, which is how the edit and
	// regenerate affordances are reachable from the keyboard (SPEC §4.4).
	useEffect(() => {
		view.registerActions({
			openChat: loadChat,
			editLastMessage: () => {
				const target = [...session.messages]
					.reverse()
					.find((message) => message.role === 'user');
				if (!target) return false;
				setEditingId(target.id);
				return true;
			},
			regenerateLastReply: () => {
				const target = [...session.messages]
					.reverse()
					.find((message) => message.role === 'assistant');
				if (!target || target.id === session.streamingId) return false;
				session.rewind({ messageId: target.id, mode: 'regenerate' });
				return true;
			},
			stop: () => {
				if (session.streamingId === null) return false;
				session.stop();
				return true;
			},
			newChat: session.newChat,
		});
	}, [view, session, loadChat]);

	const openPicker = useCallback(() => {
		new FilePickerModal(
			plugin.app,
			new Set(context.paths),
			plugin.settings.chatFolder,
			(file) => {
				context.attach([file.path]);
			},
		).open();
	}, [plugin, context]);

	const openHistory = useCallback(() => {
		new HistoryModal(
			plugin.app,
			plugin.settings.chatFolder,
			loadChat,
		).open();
	}, [plugin, loadChat]);

	const openParent = useCallback(() => {
		if (session.parentPath === null) return;
		const parent = plugin.app.vault.getAbstractFileByPath(
			session.parentPath,
		);
		if (parent instanceof TFile) {
			loadChat(parent);
		} else {
			new Notice('Chatterbox: the parent chat is no longer in the vault.');
		}
	}, [plugin, session.parentPath, loadChat]);

	const onDrop = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			setDragging(false);

			const report = resolveDrop(plugin.app, event.dataTransfer);

			if (report.paths.length === 0) {
				// Log the whole payload: which route Obsidian used for a given
				// drag is not documented, and this is the only way to tell.
				console.error('Chatterbox: unresolved drop', report);
				new Notice(
					'Chatterbox: could not match that to a note in this vault. See the developer console for what the drop contained.',
					10000,
				);
				return;
			}
			context.attach(report.paths);
		},
		[plugin, context],
	);

	return (
		<div
			className={`chatterbox-panel${dragging ? ' chatterbox-dropping' : ''}`}
			onDragOver={(event) => {
				// Required, or the browser refuses the drop entirely.
				event.preventDefault();
				setDragging(true);
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) {
					setDragging(false);
				}
			}}
			onDrop={onDrop}
		>
			<div className="chatterbox-active-file">
				<span className="chatterbox-active-file-name">
					{session.file && (
						<span title={session.file.path}>
							{session.file.basename}
						</span>
					)}
					{session.parentPath !== null && (
						<>
							{' · '}
							<a
								href="#"
								title={session.parentPath}
								onClick={(event) => {
									event.preventDefault();
									openParent();
								}}
							>
								forked from{' '}
								{session.parentPath
									.split('/')
									.pop()
									?.replace(/\.md$/, '')}
							</a>
						</>
					)}
				</span>

				{/* Separate windows do not exist on mobile. */}
				{!Platform.isMobile && (
					<button
						className="chatterbox-placement"
						aria-label={inWindow ? 'Move back to the sidebar' : 'Open in a separate window'}
						title={inWindow ? 'Move back to the sidebar' : 'Open in a separate window'}
						onClick={() => {
							void plugin.openPanel(inWindow ? 'sidebar' : 'window');
						}}
					>
						<Icon
							name={inWindow ? 'panel-right' : 'external-link'}
							fallback={inWindow ? '⇤' : '⇗'}
						/>
					</button>
				)}
			</div>

			{session.lastError !== null && (
				<div className="chatterbox-error" role="alert">
					<span>{session.lastError}</span>
					<button
						onClick={session.dismissError}
						aria-label="Dismiss error"
					>
						×
					</button>
				</div>
			)}

			<MessageList
				plugin={plugin}
				editingId={editingId}
				onEditingChange={setEditingId}
				messages={session.messages}
				streamingId={session.streamingId}
				model={session.model}
				parameters={session.parameters}
				onRewind={session.rewind}
			/>

			<ControlBar
				plugin={plugin}
				session={session}
				drawer={drawer}
				onDrawerChange={setDrawer}
				onAttach={openPicker}
				onHistory={openHistory}
				disabled={streaming}
			/>

			<Composer
				onSend={session.send}
				onMention={openPicker}
				onFocus={closeDrawers}
				onStop={session.stop}
				streaming={streaming}
				sendShortcut={plugin.settings.sendShortcut}
				disabled={streaming}
			/>
		</div>
	);
}
