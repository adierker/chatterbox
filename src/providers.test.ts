import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	ProviderPins,
	parseProviderPins,
	providerRoutingFor,
	serializeProviderPins,
} from './providers';

const PINS: ProviderPins = { 'moonshotai/kimi-k3': ['moonshotai'] };

describe('parseProviderPins', () => {
	it('reads one model per line', () => {
		assert.deepEqual(
			parseProviderPins(
				'moonshotai/kimi-k3 = moonshotai\nz-ai/glm-5.2 = z-ai, fireworks',
			),
			{
				'moonshotai/kimi-k3': ['moonshotai'],
				'z-ai/glm-5.2': ['z-ai', 'fireworks'],
			},
		);
	});

	it('ignores lines with no providers', () => {
		assert.deepEqual(parseProviderPins('a/b =\n\nnonsense'), {});
	});

	it('round-trips through serialize', () => {
		const text = 'moonshotai/kimi-k3 = moonshotai';
		assert.equal(serializeProviderPins(parseProviderPins(text)), text);
	});
});

describe('providerRoutingFor', () => {
	it('pins a listed model and disables fallbacks', () => {
		assert.deepEqual(providerRoutingFor('moonshotai/kimi-k3', PINS), {
			only: ['moonshotai'],
			allow_fallbacks: false,
		});
	});

	it('returns null for an unlisted model, so the field is omitted', () => {
		assert.equal(providerRoutingFor('z-ai/glm-5.2', PINS), null);
	});

	it('treats an empty list as unpinned rather than as nothing allowed', () => {
		assert.equal(providerRoutingFor('a/b', { 'a/b': [] }), null);
	});

	it('does not hand out the array stored in settings', () => {
		const routing = providerRoutingFor('moonshotai/kimi-k3', PINS);
		routing?.only.push('fireworks');
		assert.deepEqual(PINS['moonshotai/kimi-k3'], ['moonshotai']);
	});
});
