import { ChatMessage, Role } from './types';

/**
 * Operations on the message array. These are pure and must stay free of React
 * and Obsidian imports so they can be unit tested without rendering.
 */

export function newId(): string {
	return crypto.randomUUID().slice(0, 8);
}

export function createMessage(
	role: Role,
	content: string,
	model?: string,
): ChatMessage {
	const message: ChatMessage = { id: newId(), role, content };
	return model === undefined ? message : { ...message, model };
}

export function appendMessage(
	messages: readonly ChatMessage[],
	message: ChatMessage,
): ChatMessage[] {
	return [...messages, message];
}

/** Replaces the content of one message, identified by id. Used by streaming. */
export function setContent(
	messages: readonly ChatMessage[],
	id: string,
	content: string,
): ChatMessage[] {
	return messages.map((message) =>
		message.id === id ? { ...message, content } : message,
	);
}

/** Appends text to one message, identified by id. Used by streaming. */
export function appendContent(
	messages: readonly ChatMessage[],
	id: string,
	delta: string,
): ChatMessage[] {
	return messages.map((message) =>
		message.id === id
			? { ...message, content: message.content + delta }
			: message,
	);
}

/** Appends streamed thinking to one message, identified by id. */
export function appendReasoning(
	messages: readonly ChatMessage[],
	id: string,
	delta: string,
): ChatMessage[] {
	return messages.map((message) =>
		message.id === id
			? { ...message, reasoning: (message.reasoning ?? '') + delta }
			: message,
	);
}
