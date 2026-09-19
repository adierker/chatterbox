import { ChatMessage, ChatParameters } from './types';
import { ProviderRouting } from './providers';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Sent so OpenRouter can attribute requests to this plugin. */
const REFERER = 'https://github.com/adierker/chatterbox';
const TITLE = 'Chatterbox';

export interface CompletionRequest {
	apiKey: string;
	model: string;
	messages: readonly ChatMessage[];
	/** System prompt plus expanded context, or null to send neither. */
	system?: string | null;
	parameters?: ChatParameters;
	/** Restricts which upstream providers may serve this request. */
	provider?: ProviderRouting | null;
	/** Results to fetch when web search is on. Ignored when it is off. */
	webMaxResults?: number;
	signal?: AbortSignal;
}

/**
 * Builds the request body. Unset means omitted, never defaulted (SPEC §4.6):
 * some models reject parameters they do not support, and a silently supplied
 * default turns that into a confusing API error.
 *
 * Field names verified against OpenRouter's live documentation.
 */
export function buildRequestBody(
	request: Omit<CompletionRequest, 'apiKey' | 'signal'>,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: request.model,
		messages: [
			...(request.system !== null && request.system !== undefined
				? [{ role: 'system', content: request.system }]
				: []),
			...request.messages.map(({ role, content }) => ({ role, content })),
		],
		stream: true,
	};

	if (request.provider) body['provider'] = request.provider;

	const parameters = request.parameters ?? {};

	if (parameters.temperature !== undefined) {
		body['temperature'] = parameters.temperature;
	}
	if (parameters.topP !== undefined) {
		body['top_p'] = parameters.topP;
	}
	if (parameters.maxTokens !== undefined) {
		body['max_tokens'] = parameters.maxTokens;
	}

	// Three states. Unset sends nothing, leaving the provider's own behaviour
	// alone. True enables reasoning, at an explicit effort when one is set.
	// False disables it outright, which omitting the field does not do on a
	// model that reasons by default.
	if (parameters.reasoning === true) {
		body['reasoning'] =
			parameters.reasoningEffort === undefined
				? { enabled: true }
				: { effort: parameters.reasoningEffort };
	} else if (parameters.reasoning === false) {
		body['reasoning'] = { enabled: false };
	}

	// Server tools, not the `web` plugin. The plugin sends the last user
	// message to the search engine verbatim and staples the results on before
	// the model runs, so "try now" searches for the phrase "try now". These let
	// the model write its own queries, search more than once or not at all, and
	// fetch a page it has found a link to.
	//
	// Still one request and one stream: OpenRouter runs the tools on its own
	// servers and never hands back a tool call, so there is no agent loop here
	// (SPEC §2). Requires a model that supports tool calling.
	if (parameters.webSearch === true) {
		body['tools'] = [
			{
				type: 'openrouter:web_search',
				...(request.webMaxResults !== undefined
					? { parameters: { max_results: request.webMaxResults } }
					: {}),
			},
			{ type: 'openrouter:web_fetch' },
		];
	}

	return body;
}

export interface SseParseResult {
	/** Payloads of complete `data:` lines, in order. */
	events: string[];
	/** Trailing partial line, to be prefixed onto the next chunk. */
	rest: string;
}

/**
 * Splits a raw SSE buffer into complete `data:` payloads plus whatever partial
 * line is left over. A network chunk can end mid-line, so the caller must feed
 * `rest` back in with the next chunk.
 */
export function parseSseBuffer(buffer: string): SseParseResult {
	const events: string[] = [];
	let rest = buffer;

	for (
		let breakAt = rest.indexOf('\n');
		breakAt !== -1;
		breakAt = rest.indexOf('\n')
	) {
		const line = rest.slice(0, breakAt).replace(/\r$/, '');
		rest = rest.slice(breakAt + 1);

		// Comments are keepalives — OpenRouter sends ": OPENROUTER PROCESSING"
		// while a request waits on a provider. Per the SSE spec they are ignored.
		if (line.startsWith(':')) continue;
		if (!line.startsWith('data:')) continue;

		events.push(line.slice('data:'.length).trim());
	}

	return { events, rest };
}

/** One piece of a reply: either the answer itself or the thinking behind it. */
export interface StreamDelta {
	kind: 'content' | 'reasoning';
	text: string;
}

interface ReasoningDetail {
	type?: string;
	text?: string;
	summary?: string;
}

interface StreamChunk {
	choices?: {
		delta?: {
			content?: string;
			reasoning?: string;
			reasoning_details?: ReasoningDetail[];
		};
	}[];
	error?: { message?: string };
}

/**
 * Pulls the deltas out of one SSE payload. A chunk can carry reasoning and
 * content at once, and several reasoning details at once, so this returns a
 * list — empty for payloads that carry no text (role-only openers, usage-only
 * final chunks).
 *
 * @throws if the payload is an error object or is not JSON at all.
 */
export function extractDeltas(payload: string): StreamDelta[] {
	let chunk: StreamChunk;
	try {
		chunk = JSON.parse(payload) as StreamChunk;
	} catch {
		throw new Error(`Unreadable stream chunk from OpenRouter: ${payload}`);
	}

	if (chunk.error) {
		throw new Error(chunk.error.message ?? 'Unknown OpenRouter stream error');
	}

	const delta = chunk.choices?.[0]?.delta;
	if (!delta) return [];

	const deltas: StreamDelta[] = [];

	// reasoning_details is the current field and reasoning the legacy one.
	// Only fall back when details are absent: a provider that sends both would
	// otherwise have its thinking counted twice. Encrypted details carry no
	// readable text and are skipped.
	if (delta.reasoning_details) {
		for (const detail of delta.reasoning_details) {
			const text = detail.text ?? detail.summary;
			if (text !== undefined && text !== '') {
				deltas.push({ kind: 'reasoning', text });
			}
		}
	} else if (delta.reasoning !== undefined && delta.reasoning !== '') {
		deltas.push({ kind: 'reasoning', text: delta.reasoning });
	}

	if (delta.content !== undefined && delta.content !== '') {
		deltas.push({ kind: 'content', text: delta.content });
	}

	return deltas;
}

async function readErrorMessage(response: Response): Promise<string> {
	const body = await response.text().catch(() => '');
	const parsed: unknown = tryParseJson(body);
	const message =
		typeof parsed === 'object' &&
		parsed !== null &&
		'error' in parsed &&
		typeof (parsed as { error?: { message?: unknown } }).error?.message ===
			'string'
			? (parsed as { error: { message: string } }).error.message
			: body || response.statusText;

	return `OpenRouter ${String(response.status)}: ${message}`;
}

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Streams a chat completion, yielding text deltas as they arrive.
 *
 * Uses `fetch` rather than Obsidian's `requestUrl`: `requestUrl` bypasses CORS
 * but buffers the whole response, so it cannot stream.
 */
export async function* streamCompletion(
	request: CompletionRequest,
): AsyncGenerator<StreamDelta> {
	const response = await fetch(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${request.apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': REFERER,
			'X-Title': TITLE,
		},
		body: JSON.stringify(buildRequestBody(request)),
		signal: request.signal,
	});

	if (!response.ok) {
		throw new Error(await readErrorMessage(response));
	}
	if (!response.body) {
		throw new Error('OpenRouter returned no response body.');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const { events, rest } = parseSseBuffer(buffer);
			buffer = rest;

			for (const payload of events) {
				if (payload === '[DONE]') return;
				yield* extractDeltas(payload);
			}
		}
	} finally {
		reader.releaseLock();
	}
}
