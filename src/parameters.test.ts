import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReasoningEffort } from './types';
import {
	ALL_EFFORTS,
	effortOptionsFor,
	parseEffortOptions,
	reconcileEffort,
	serializeEffortOptions,
	validateParameters,
} from './parameters';

const CONFIGURED: Record<string, ReasoningEffort[]> = {
	'z-ai/glm-5.2': ['high', 'xhigh'],
	'moonshotai/kimi-k3': ['low', 'high', 'max'],
};

describe('effortOptionsFor', () => {
	it('restricts a configured model to its own levels', () => {
		assert.deepEqual(effortOptionsFor('z-ai/glm-5.2', { ...CONFIGURED }), [
			'high',
			'xhigh',
		]);
	});

	it('offers everything for a model with no configuration', () => {
		assert.deepEqual(
			effortOptionsFor('openai/gpt-5.1', { ...CONFIGURED }),
			ALL_EFFORTS,
		);
	});

	it('treats an empty list as unconfigured rather than as nothing allowed', () => {
		assert.deepEqual(
			effortOptionsFor('some/model', { 'some/model': [] }),
			ALL_EFFORTS,
		);
	});
});

describe('parseEffortOptions', () => {
	it('reads one model per line', () => {
		assert.deepEqual(
			parseEffortOptions(
				'z-ai/glm-5.2 = high, xhigh\nmoonshotai/kimi-k3 = low, high, max',
			),
			{
				'z-ai/glm-5.2': ['high', 'xhigh'],
				'moonshotai/kimi-k3': ['low', 'high', 'max'],
			},
		);
	});

	it('ignores values that are not real effort levels', () => {
		assert.deepEqual(parseEffortOptions('a/b = high, enormous, low'), {
			'a/b': ['high', 'low'],
		});
	});

	it('skips lines with no usable levels', () => {
		assert.deepEqual(parseEffortOptions('a/b = nonsense\n\ngarbage'), {});
	});

	it('round-trips through serialize', () => {
		const text = 'z-ai/glm-5.2 = high, xhigh';
		assert.equal(serializeEffortOptions(parseEffortOptions(text)), text);
	});
});

describe('reconcileEffort', () => {
	it('leaves a legal effort alone', () => {
		const parameters = { reasoningEffort: 'high' as const };
		assert.equal(reconcileEffort(parameters, ['high', 'xhigh']), parameters);
	});

	it('falls back when the model does not accept the current effort', () => {
		// Switching GLM to Kimi with xhigh selected must not send xhigh.
		assert.deepEqual(
			reconcileEffort({ reasoningEffort: 'xhigh' }, ['low', 'high', 'max']),
			{ reasoningEffort: 'low' },
		);
	});

	it('leaves an unset effort unset', () => {
		assert.deepEqual(reconcileEffort({}, ['high']), {});
	});
});

describe('validateParameters', () => {
	it('accepts an empty set', () => {
		assert.deepEqual(validateParameters({}), []);
	});

	it('rejects a temperature outside 0 to 2', () => {
		assert.equal(validateParameters({ temperature: 2.5 }).length, 1);
		assert.equal(validateParameters({ temperature: -1 }).length, 1);
		assert.deepEqual(validateParameters({ temperature: 2 }), []);
	});

	it('rejects a top P outside 0 to 1', () => {
		assert.equal(validateParameters({ topP: 0 }).length, 1);
		assert.equal(validateParameters({ topP: 1.5 }).length, 1);
		assert.deepEqual(validateParameters({ topP: 1 }), []);
	});

	it('rejects a fractional or non-positive token limit', () => {
		assert.equal(validateParameters({ maxTokens: 0 }).length, 1);
		assert.equal(validateParameters({ maxTokens: 10.5 }).length, 1);
		assert.deepEqual(validateParameters({ maxTokens: 4096 }), []);
	});

	it('reports every problem at once', () => {
		assert.equal(
			validateParameters({ temperature: 9, topP: 9, maxTokens: 0 }).length,
			3,
		);
	});
});
