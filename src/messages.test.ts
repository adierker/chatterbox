import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	appendContent,
	appendMessage,
	createMessage,
	setContent,
} from './messages';

describe('createMessage', () => {
	it('omits model on user messages', () => {
		const message = createMessage('user', 'hi');
		assert.equal(message.role, 'user');
		assert.equal('model' in message, false);
	});

	it('records the model on assistant messages', () => {
		const message = createMessage('assistant', '', 'z-ai/glm-5.2');
		assert.equal(message.model, 'z-ai/glm-5.2');
	});

	it('gives every message a distinct id', () => {
		const ids = new Set(
			Array.from({ length: 200 }, () => createMessage('user', 'x').id),
		);
		assert.equal(ids.size, 200);
	});
});

describe('appendMessage', () => {
	it('does not mutate the input array', () => {
		const original = [createMessage('user', 'one')];
		const next = appendMessage(original, createMessage('user', 'two'));
		assert.equal(original.length, 1);
		assert.equal(next.length, 2);
	});
});

describe('appendContent', () => {
	it('accumulates streamed deltas onto the target message', () => {
		const target = createMessage('assistant', '');
		let messages = [createMessage('user', 'q'), target];
		for (const delta of ['The ', 'middle ', 'section']) {
			messages = appendContent(messages, target.id, delta);
		}
		assert.equal(messages[1]?.content, 'The middle section');
	});

	it('leaves other messages untouched', () => {
		const first = createMessage('user', 'keep me');
		const second = createMessage('assistant', '');
		const messages = appendContent([first, second], second.id, 'x');
		assert.equal(messages[0]?.content, 'keep me');
	});

	it('is a no-op for an unknown id', () => {
		const messages = [createMessage('user', 'a')];
		assert.deepEqual(appendContent(messages, 'nope', 'x'), messages);
	});
});

describe('setContent', () => {
	it('replaces rather than appends', () => {
		const message = createMessage('user', 'before');
		const messages = setContent([message], message.id, 'after');
		assert.equal(messages[0]?.content, 'after');
	});
});
