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

		setFollow(distanceFromBottom(element) < FOLLOW_SLACK);
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
							{/*
							  * Open while it is thinking, closed once the
							  * reply starts. Reasoning almost always finishes
							  * before the first word of the answer, so a block
							  * that stays shut is shut for the whole of it.
							  */}
							<Reasoning
								text={message.reasoning}
								thinking={
									message.id === streamingId &&
									message.content === ''
								}
							/>
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
 * The model's thinking, streamed in live. A plain <details>, so it is closed
 * on arrival and openable at any point without this component holding any
 * state — including while the text is still coming in.
 *
 * Rendered as preformatted text rather than markdown: thinking is a draft, and
 * a stray heading or half-written list mid-stream would reflow the panel under
 * whatever is being read.
 */
function Reasoning({
	text,
	thinking,
}: {
	text: string | undefined;
	thinking: boolean;
}) {
	// null means "follow the stream"; true or false is the reader overriding it.
	const [override, setOverride] = useState<boolean | null>(null);
	const open = override ?? thinking;
	// Every hook runs before the early return below, or the hook count would
	// change on the render where thinking first arrives.
	const trace = useStickToBottom(open && thinking);

	if (text === undefined || text === '') return null;

	return (
		<details
			className="chatterbox-reasoning"
			open={open}
			onToggle={(event) => {
				// This fires for programmatic changes too, where the element
				// already agrees with `open`. Only a disagreement is a click.
				const next = event.currentTarget.open;
				if (next !== open) setOverride(next);
			}}
		>
			<summary>Thinking</summary>
			{/* Kept on one line: this is a <pre>, and stray indentation in the
			    markup would be part of the text. */}
			<pre ref={trace.ref} onScroll={trace.onScroll}>{text}</pre>
		</details>
	);
}

/**
 * Counts up while nothing has arrived. Some providers send absolutely nothing
 * until the model has finished thinking — half a minute of it is normal at a
 * high effort — and a motionless ellipsis through all of that is
 * indistinguishable from a request that has died.
 */
function Waiting() {
	const [seconds, setSeconds] = useState(0);

	useEffect(() => {
		// Window-qualified so a panel in a pop-out uses its own timers.
		const id = window.setInterval(() => {
			setSeconds((previous) => previous + 1);
		}, 1000);
		return () => {
			window.clearInterval(id);
		};
	}, []);

	// Silent for the first moment, so a quick reply does not flash a counter.
	return (
		<span className="chatterbox-waiting">
			{seconds < 2 ? '…' : `… ${String(seconds)}s`}
		</span>
	);
}

function distanceFromBottom(element: HTMLElement): number {
	return element.scrollHeight - element.scrollTop - element.clientHeight;
}

/** How far from the bottom of the conversation still counts as following it. */
const FOLLOW_SLACK = 64;

/**
 * Tighter inside the thinking box, which is a fraction of the panel's height:
 * 64px there is several lines, so nudging up a line or two would not release
 * the pin and the text would keep racing away.
 */
const TRACE_FOLLOW_SLACK = 16;

/**
 * Keeps a scrolling box pinned to its newest line while `active`, until the
 * reader scrolls up. The trace outgrows its box almost immediately, so without
 * the pin the visible part stops changing and looks frozen — but with an
 * unconditional pin it scrolls far too fast to read. Scrolling back to the
 * bottom resumes following.
 */
function useStickToBottom(active: boolean) {
	const ref = useRef<HTMLPreElement>(null);
	const followingRef = useRef(true);

	useEffect(() => {
		const element = ref.current;
		if (element && active && followingRef.current) {
			element.scrollTop = element.scrollHeight;
		}
	});

	// Pinning scrolls too, which lands at a distance of zero and so reads as
	// still following. Only the reader's own scrolling moves it away.
	const onScroll = () => {
		const element = ref.current;
		if (element) {
			followingRef.current =
				distanceFromBottom(element) < TRACE_FOLLOW_SLACK;
		}
	};

	return { ref, onScroll };
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
				{streaming && message.content === '' && <Waiting />}
			</div>
		);
	}

	return <MarkdownContent markdown={message.content} />;
}
