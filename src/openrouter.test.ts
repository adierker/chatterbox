import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRequestBody, extractDelta, parseSseBuffer } from './openrouter';

describe('buildRequestBody', () => {
	const base = { model: 'z-ai/glm-5.2', messages: [] };

	it('omits provider routing when the model is not pinned', () => {
		assert.equal('provider' in buildRequestBody(base), false);
	});

	it('sends the pin, with fallbacks disabled', () => {
		const body = buildRequestBody({
			...base,
			provider: { only: ['moonshotai'], allow_fallbacks: false },
		});
		assert.deepEqual(body['provider'], {
			only: ['moonshotai'],
			allow_fallbacks: false,
		});
	});

	it('always streams', () => {
		assert.equal(buildRequestBody(base)['stream'], true);
	});

	it('omits every parameter that is unset', () => {
		const body = buildRequestBody(base);
		for (const key of [
			'temperature',
			'top_p',
			'max_tokens',
			'reasoning',
		]) {
			assert.equal(key in body, false, `${key} should be absent`);
		}
	});

	it('leaves top_p absent rather than sending a default', () => {
		const body = buildRequestBody({
			...base,
			parameters: { temperature: 0.7 },
		});
		assert.equal(body['temperature'], 0.7);
		assert.equal('top_p' in body, false);
	});

	it('sends nothing about reasoning when it is unset', () => {
		// Unset leaves the provider's own behaviour alone.
		const body = buildRequestBody({
			...base,
			parameters: { reasoningEffort: 'high' },
		});
		assert.equal('reasoning' in body, false);
	});

	it('disables reasoning explicitly when off, ignoring any effort', () => {
		// Omitting the field would not switch off a model that reasons by
		// default, so off has to be said out loud.
		const body = buildRequestBody({
			...base,
			parameters: { reasoning: false, reasoningEffort: 'high' },
		});
		assert.deepEqual(body['reasoning'], { enabled: false });
	});

	it('sends the effort when reasoning is on', () => {
		const body = buildRequestBody({
			...base,
			parameters: { reasoning: true, reasoningEffort: 'high' },
		});
		assert.deepEqual(body['reasoning'], { effort: 'high' });
	});

	it('enables reasoning at the provider default when no effort is set', () => {
		const body = buildRequestBody({
			...base,
			parameters: { reasoning: true },
		});
		assert.deepEqual(body['reasoning'], { enabled: true });
	});

	it('omits the web tools unless search is on', () => {
		// Unset is off: search pulls in material the author never attached, so
		// it must never happen by omission.
		assert.equal('tools' in buildRequestBody(base), false);
		assert.equal(
			'tools' in
				buildRequestBody({ ...base, parameters: { webSearch: false } }),
			false,
		);
	});

	it('sends server tools, so the model writes its own queries', () => {
		// Not the `web` plugin: that searches for the last user message
		// verbatim, which turns "try now" into a search for "try now".
		const body = buildRequestBody({
			...base,
			parameters: { webSearch: true },
			webMaxResults: 5,
		});
		assert.deepEqual(body['tools'], [
			{
				type: 'openrouter:web_search',
				parameters: { max_results: 5 },
			},
			{ type: 'openrouter:web_fetch' },
		]);
	});

	it('leaves the result count to OpenRouter when none is given', () => {
		const body = buildRequestBody({ ...base, parameters: { webSearch: true } });
		assert.deepEqual(body['tools'], [
			{ type: 'openrouter:web_search' },
			{ type: 'openrouter:web_fetch' },
		]);
	});

	it('ignores the result count while search is off', () => {
		const body = buildRequestBody({ ...base, webMaxResults: 5 });
		assert.equal('tools' in body, false);
	});

	it('prepends the system message only when there is one', () => {
		const withSystem = buildRequestBody({ ...base, system: 'Be terse.' });
		assert.deepEqual(withSystem['messages'], [
			{ role: 'system', content: 'Be terse.' },
		]);
		assert.deepEqual(buildRequestBody({ ...base, system: null })['messages'], []);
	});

	it('sends only role and content, not internal message fields', () => {
		const body = buildRequestBody({
			...base,
			messages: [
				{
					id: 'a1',
					role: 'assistant',
					content: 'Hi',
					model: 'z-ai/glm-5.2',
					parameters: { temperature: 0.7 },
				},
			],
		});
		assert.deepEqual(body['messages'], [{ role: 'assistant', content: 'Hi' }]);
	});
});

describe('parseSseBuffer', () => {
	it('reads complete data lines', () => {
		const { events, rest } = parseSseBuffer('data: {"a":1}\ndata: {"a":2}\n');
		assert.deepEqual(events, ['{"a":1}', '{"a":2}']);
		assert.equal(rest, '');
	});

	it('holds back a partial trailing line', () => {
		const { events, rest } = parseSseBuffer('data: {"a":1}\ndata: {"par');
		assert.deepEqual(events, ['{"a":1}']);
		assert.equal(rest, 'data: {"par');
	});

	it('reassembles a payload split across two chunks', () => {
		const first = parseSseBuffer('data: {"choices":[{"delta":{"cont');
		assert.deepEqual(first.events, []);

		const second = parseSseBuffer(first.rest + 'ent":"hi"}}]}\n');
		assert.deepEqual(second.events, ['{"choices":[{"delta":{"content":"hi"}}]}']);
		assert.equal(second.rest, '');
	});

	it('skips the OPENROUTER PROCESSING keepalive comment', () => {
		const { events } = parseSseBuffer(
			': OPENROUTER PROCESSING\n\ndata: {"a":1}\n',
		);
		assert.deepEqual(events, ['{"a":1}']);
	});

	it('skips blank lines and non-data fields', () => {
		const { events } = parseSseBuffer(
			'\nevent: message\nid: 7\ndata: {"a":1}\n\n',
		);
		assert.deepEqual(events, ['{"a":1}']);
	});

	it('tolerates CRLF line endings', () => {
		const { events } = parseSseBuffer('data: {"a":1}\r\ndata: [DONE]\r\n');
		assert.deepEqual(events, ['{"a":1}', '[DONE]']);
	});

	it('returns the whole buffer as rest when no line is complete', () => {
		const { events, rest } = parseSseBuffer('data: partial');
		assert.deepEqual(events, []);
		assert.equal(rest, 'data: partial');
	});
});

describe('extractDelta', () => {
	it('pulls out the content delta', () => {
		const payload = '{"choices":[{"delta":{"content":"Hello"}}]}';
		assert.equal(extractDelta(payload), 'Hello');
	});

	it('returns null for a role-only opening chunk', () => {
		const payload = '{"choices":[{"delta":{"role":"assistant"}}]}';
		assert.equal(extractDelta(payload), null);
	});

	it('returns null for a usage-only final chunk', () => {
		const payload = '{"choices":[],"usage":{"total_tokens":12}}';
		assert.equal(extractDelta(payload), null);
	});

	it('throws with the message from a mid-stream error object', () => {
		const payload = '{"error":{"code":429,"message":"Rate limited"}}';
		assert.throws(() => extractDelta(payload), /Rate limited/);
	});

	it('throws on a payload that is not JSON', () => {
		assert.throws(() => extractDelta('<html>502</html>'), /Unreadable/);
	});
});
