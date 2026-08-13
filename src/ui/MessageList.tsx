import { useEffect, useRef } from 'react';
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
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (editingId === null) bottomRef.current?.scrollIntoView({ block: 'end' });
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

	return (
		<div className="chatterbox-messages">
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
			<div ref={bottomRef} />
		</div>
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
