import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RewindError, planRewind } from './rewind';
import { ChatMessage } from './types';

function conversation(): ChatMessage[] {
	return [
		{ id: 'u1', role: 'user', content: 'one' },
		{ id: 'a1', role: 'assistant', content: 'reply one', model: 'm' },
		{ id: 'u2', role: 'user', content: 'two' },
		{ id: 'a2', role: 'assistant', content: 'reply two', model: 'm' },
		{ id: 'u3', role: 'user', content: 'three' },
	];
}

describe('editing a user message', () => {
	it('drops everything after it', () => {
		const plan = planRewind(conversation(), 'u2', 'edit', 'two revised');
		assert.deepEqual(
			plan.messages.map((message) => message.id),
			['u1', 'a1', 'u2'],
		);
		assert.equal(plan.dropped, 2);
	});

	it('replaces the text at that position', () => {
		const plan = planRewind(conversation(), 'u2', 'edit', 'two revised');
		assert.equal(plan.messages[2]?.content, 'two revised');
	});

	it('keeps the message id, so the fork records the same turn', () => {
		const plan = planRewind(conversation(), 'u2', 'edit', 'x');
		assert.equal(plan.messages[2]?.id, 'u2');
	});

	it('requests a new reply', () => {
		assert.equal(planRewind(conversation(), 'u2', 'edit', 'x').sends, true);
	});

	it('forks, because replies were dropped', () => {
		assert.equal(planRewind(conversation(), 'u2', 'edit', 'x').needsFork, true);
	});

	it('does not fork when it is the last message and nothing is lost', () => {
		// The case where a request failed and you are retrying.
		const plan = planRewind(conversation(), 'u3', 'edit', 'three revised');
		assert.equal(plan.dropped, 0);
		assert.equal(plan.needsFork, false);
		assert.equal(plan.sends, true);
	});

	it('forks on an unchanged resend when replies follow it', () => {
		// Re-sending with only the model or parameters changed (SPEC §4.4).
		const plan = planRewind(conversation(), 'u2', 'edit');
		assert.equal(plan.messages[2]?.content, 'two');
		assert.equal(plan.needsFork, true);
	});

	it('leaves the original array untouched', () => {
		const original = conversation();
		planRewind(original, 'u1', 'edit', 'changed');
		assert.equal(original.length, 5);
		assert.equal(original[0]?.content, 'one');
	});
});

describe('editing an assistant message', () => {
	it('drops everything after it', () => {
		const plan = planRewind(conversation(), 'a1', 'edit', 'reworded');
		assert.deepEqual(
			plan.messages.map((message) => message.id),
			['u1', 'a1'],
		);
	});

	it('marks the message as edited so the transcript stays honest', () => {
		const plan = planRewind(conversation(), 'a1', 'edit', 'reworded');
		assert.equal(plan.messages[1]?.edited, true);
	});

	it('does not request a new reply — it steers, then you continue', () => {
		assert.equal(planRewind(conversation(), 'a1', 'edit', 'x').sends, false);
	});

	it('forks even as the last message, because the reply is overwritten', () => {
		const short: ChatMessage[] = [
			{ id: 'u1', role: 'user', content: 'one' },
			{ id: 'a1', role: 'assistant', content: 'original', model: 'm' },
		];
		const plan = planRewind(short, 'a1', 'edit', 'rewritten');
		assert.equal(plan.dropped, 0);
		assert.equal(plan.needsFork, true);
	});

	it('does not fork when the text is unchanged and nothing is dropped', () => {
		const short: ChatMessage[] = [
			{ id: 'u1', role: 'user', content: 'one' },
			{ id: 'a1', role: 'assistant', content: 'original', model: 'm' },
		];
		assert.equal(planRewind(short, 'a1', 'edit', 'original').needsFork, false);
	});
});

describe('regenerating', () => {
	it('drops the reply and everything after it', () => {
		const plan = planRewind(conversation(), 'a1', 'regenerate');
		assert.deepEqual(
			plan.messages.map((message) => message.id),
			['u1'],
		);
		assert.equal(plan.dropped, 4);
	});

	it('re-requests with the identical history', () => {
		const plan = planRewind(conversation(), 'a2', 'regenerate');
		assert.deepEqual(
			plan.messages.map((message) => message.id),
			['u1', 'a1', 'u2'],
		);
		assert.equal(plan.sends, true);
	});

	it('always forks, because a reply is being discarded', () => {
		assert.equal(planRewind(conversation(), 'a2', 'regenerate').needsFork, true);
	});

	it('refuses to regenerate a user message', () => {
		assert.throws(
			() => planRewind(conversation(), 'u1', 'regenerate'),
			RewindError,
		);
	});
});

describe('failures', () => {
	it('refuses an id that is not in the conversation', () => {
		assert.throws(() => planRewind(conversation(), 'nope', 'edit', 'x'), RewindError);
	});
});
