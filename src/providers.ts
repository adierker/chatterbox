/**
 * Provider routing (OpenRouter's `provider` request field). Pure, so the
 * settings format and the routing decision are testable.
 *
 * Not a provider abstraction layer — SPEC §2 rules those out. This is an
 * OpenRouter-native field that constrains which of its upstream providers may
 * serve a request. It matters because prompt caches live with the provider:
 * a model served by fifteen of them lands on a cold cache most requests, and
 * this plugin re-sends the whole attached context every turn.
 */

/** Model slug → the provider slugs allowed to serve it. */
export type ProviderPins = Record<string, string[]>;

export interface ProviderRouting {
	only?: string[];
	ignore?: string[];
	/**
	 * Set false only alongside `only`. A pinned provider that is down fails
	 * loudly with OpenRouter's own error rather than silently routing to a
	 * cold, differently-priced provider mid-conversation. A blocklist does the
	 * opposite — it wants free routing among everything that is left — so it
	 * leaves fallbacks alone.
	 */
	allow_fallbacks?: boolean;
}

/** Key meaning "every model" in a blocklist. */
export const ALL_MODELS = '*';

/** Settings format: one `model = provider, provider` line per model. */
export function parseProviderPins(text: string): ProviderPins {
	const pins: ProviderPins = {};

	for (const line of text.split('\n')) {
		const separator = line.indexOf('=');
		if (separator === -1) continue;

		const model = line.slice(0, separator).trim();
		if (model === '') continue;

		const providers = line
			.slice(separator + 1)
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry !== '');

		if (providers.length > 0) pins[model] = providers;
	}

	return pins;
}

export function serializeProviderPins(pins: ProviderPins): string {
	return Object.entries(pins)
		.map(([model, providers]) => `${model} = ${providers.join(', ')}`)
		.join('\n');
}

/**
 * Null when a model is neither pinned nor has anything blocked, so the field is
 * omitted entirely. Blocks accept `*` for providers to avoid everywhere —
 * a provider that filters or rewrites output is objectionable whichever model
 * it happens to be serving.
 */
export function providerRoutingFor(
	model: string,
	pins: ProviderPins,
	blocks: ProviderPins = {},
): ProviderRouting | null {
	const only = pins[model] ?? [];
	const ignore = [
		...new Set([...(blocks[ALL_MODELS] ?? []), ...(blocks[model] ?? [])]),
	];

	if (only.length === 0 && ignore.length === 0) return null;

	return {
		...(only.length > 0 ? { only: [...only], allow_fallbacks: false } : {}),
		...(ignore.length > 0 ? { ignore } : {}),
	};
}
