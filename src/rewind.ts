import { ChatMessage } from './types';

/**
 * Working out what an edit or a regenerate does to the conversation, before
 * anything is written. Pure, because this is the operation that must never
 * lose a message (SPEC §4.4).
 */

export type RewindMode = 'edit' | 'regenerate';

export class RewindError extends Error {}

export interface RewindPlan {
	/** Position of the target message in the original list. */
	index: number;
	/** The conversation after the rewind. */
	messages: ChatMessage[];
	/** How many messages the rewind removes. */
	dropped: number;
	/**
	 * Whether the original has to be preserved as its own file first. False
	 * only when the rewind destroys nothing at all — retrying a message whose
	 * request failed, for instance.
	 */
	needsFork: boolean;
	/** Whether a completion should be requested afterwards. */
	sends: boolean;
}

export function planRewind(
	messages: readonly ChatMessage[],
	id: string,
	mode: RewindMode,
	content?: string,
): RewindPlan {
	const index = messages.findIndex((message) => message.id === id);
	if (index === -1) {
		throw new RewindError('That message is no longer in this conversation.');
	}

	const target = messages[index];
	if (!target) {
		throw new RewindError('That message is no longer in this conversation.');
	}

	if (mode === 'regenerate') {
		if (target.role !== 'assistant') {
			throw new RewindError('Only a reply can be regenerated.');
		}
		// Drop this reply and everything after it, then re-request with the
		// identical history that produced it.
		return {
			index,
			messages: messages.slice(0, index),
			dropped: messages.length - index,
			needsFork: true,
			sends: true,
		};
	}

	const text = content ?? target.content;
	const edited: ChatMessage = {
		...target,
		content: text,
		// An assistant message the user rewrote is flagged, so the transcript
		// never implies the model produced that text.
		...(target.role === 'assistant' ? { edited: true } : {}),
	};

	const kept = [...messages.slice(0, index), edited];
	const dropped = messages.length - kept.length;

	// Rewriting a reply destroys the model's original words even when nothing
	// after it is dropped, so that always forks. Rewriting your own last
	// message destroys nothing worth keeping.
	const rewritesReply =
		target.role === 'assistant' && text !== target.content;

	return {
		index,
		messages: kept,
		dropped,
		needsFork: dropped > 0 || rewritesReply,
		// Editing a reply steers the conversation; it does not ask for a new
		// one. You continue from the composer.
		sends: target.role === 'user',
	};
}
