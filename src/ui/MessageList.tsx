import { useEffect, useRef, useState } from 'react';
import { Notice } from 'obsidian';
import type ChatterboxPlugin from '../main';
import { ChatMessage, ChatParameters } from '../types';
import { MarkdownContent } from './MarkdownContent';
import { MessageEditor } from './MessageEditor';
import { Icon } from './Icon';
import type { RewindRequest } from './useSession';

interface MessageListProps {
	plugin: ChatterboxPlugin;
	/** Controlled by the panel so commands can open an editor too. */
	editingId: string | null;
	onEditingChange: (id: string | null) => void;
	messages: ChatMessage[];
	streamingId: string | null;
	model: string;
	parameters: ChatParameters;
	onRewind: (request: RewindRequest) => void;
}

export function MessageList({
	plugin,
	editingId,
	onEditingChange,
	messages,
	streamingId,
	model,
	parameters,
	onRewind,
}: MessageListProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	// Whether the view is following the bottom. A ref as well as state because
	// the scroll effect reads it without wanting to re-run when it changes.
	const followingRef = useRef(true);
	const [following, setFollowing] = useState(true);
	const countRef = useRef(messages.length);

	const setFollow = (value: boolean) => {
		if (followingRef.current === value) return;
		followingRef.current = value;
		setFollowing(value);
	};

	/**
	 * Follow new output only while the reader is already at the bottom. A long
	 * reply should be readable from the top while the rest of it streams in,
	 * which is impossible if every token yanks the view back down.
	 */
	const onScroll = () => {
		const element = scrollRef.current;
		if (!element) return;

		const distance =
			element.scrollHeight - element.scrollTop - element.clientHeight;
		setFollow(distance < 64);
	};

	useEffect(() => {
		const element = scrollRef.current;
		if (!element || editingId !== null) return;

		// A new message — sending, or a rewind landing — means the reader
		// acted, so resume following even if they had scrolled away.
		if (messages.length !== countRef.current) {
			countRef.current = messages.length;
			followingRef.current = true;
			setFollowing(true);
		}

		if (followingRef.current) element.scrollTop = element.scrollHeight;
	}, [messages, editingId]);

	// An edit target that vanished (a rewind landed) must not stay open.
	useEffect(() => {
		if (editingId !== null && !messages.some((m) => m.id === editingId)) {
			onEditingChange(null);
		}
	}, [messages, editingId, onEditingChange]);

	if (messages.length === 0) {
		return (
			<div className="chatterbox-messages chatterbox-empty">
				<p>Nothing here yet.</p>
			</div>
		);
	}

	const jumpToLatest = () => {
		const element = scrollRef.current;
		if (!element) return;
		element.scrollTop = element.scrollHeight;
		setFollow(true);
	};

	return (
		<div className="chatterbox-message-area">
			<div
				className="chatterbox-messages"
				ref={scrollRef}
				onScroll={onScroll}
			>
			{messages.map((message) => (
				<div
					key={message.id}
					className={`chatterbox-message chatterbox-${message.role}`}
				>
					{message.role === 'assistant' && (
						<div className="chatterbox-message-model">
							{message.model}
							{message.edited === true && ' · edited by you'}
						</div>
					)}

					{editingId === message.id ? (
						<MessageEditor
							plugin={plugin}
							message={message}
							model={model}
							parameters={parameters}
							onCancel={() => {
								onEditingChange(null);
							}}
							onSubmit={(content, nextModel, nextParameters) => {
								onEditingChange(null);
								onRewind({
									messageId: message.id,
									mode: 'edit',
									content,
									model: nextModel,
									parameters: nextParameters,
								});
							}}
						/>
					) : (
						<>
							<Body
								message={message}
								streaming={message.id === streamingId}
							/>
							{message.id !== streamingId && (
								<div className="chatterbox-message-actions">
									<CopyButton text={message.content} />
									<button
										aria-label="Edit this message"
										title="Edit"
										onClick={() => {
											onEditingChange(message.id);
										}}
									>
										<Icon name="pencil" fallback="✎" />
									</button>
									{message.role === 'assistant' && (
										<button
											aria-label="Regenerate this reply"
											title="Regenerate"
											onClick={() => {
												onRewind({
													messageId: message.id,
													mode: 'regenerate',
												});
											}}
										>
											<Icon
												name="rotate-ccw"
												fallback="↻"
											/>
										</button>
									)}
								</div>
							)}
						</>
					)}
				</div>
			))}
			</div>

			{!following && (
				<button
					className="chatterbox-jump"
					onClick={jumpToLatest}
					aria-label="Jump to latest"
					title="Jump to latest"
				>
					<Icon name="chevron-down" fallback="↓" />
				</button>
			)}
		</div>
	);
}

/**
 * Copies a message's text. Confirms by swapping to a tick rather than firing a
 * Notice, which would be heavy for something done repeatedly.
 */
function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		};
	}, []);

	const copy = () => {
		navigator.clipboard.writeText(text).then(
			() => {
				setCopied(true);
				if (timer.current !== null) window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => {
					setCopied(false);
				}, 1500);
			},
			() => {
				new Notice('Chatterbox: could not write to the clipboard.');
			},
		);
	};

	return (
		<button
			aria-label="Copy this message"
			title={copied ? 'Copied' : 'Copy'}
			onClick={copy}
		>
			<Icon
				name={copied ? 'check' : 'copy'}
				fallback={copied ? '✓' : '⧉'}
			/>
		</button>
	);
}

function Body({
	message,
	streaming,
}: {
	message: ChatMessage;
	streaming: boolean;
}) {
	if (streaming || message.role === 'user') {
		// Plain text while streaming: re-running MarkdownRenderer on every
		// token is too expensive for a long response. It renders as markdown
		// once the stream finishes.
		return (
			<div className="chatterbox-plain">
				{message.content}
				{streaming && message.content === '' && (
					<span className="chatterbox-waiting">…</span>
				)}
			</div>
		);
	}

	return <MarkdownContent markdown={message.content} />;
}
