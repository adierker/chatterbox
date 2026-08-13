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

interface StreamChunk {
	choices?: { delta?: { content?: string } }[];
	error?: { message?: string };
}

/**
 * Pulls the text delta out of one SSE payload. Returns null for payloads that
 * carry no text (role-only openers, usage-only final chunks).
 *
 * @throws if the payload is an error object or is not JSON at all.
 */
export function extractDelta(payload: string): string | null {
	let chunk: StreamChunk;
	try {
		chunk = JSON.parse(payload) as StreamChunk;
	} catch {
		throw new Error(`Unreadable stream chunk from OpenRouter: ${payload}`);
	}

	if (chunk.error) {
		throw new Error(chunk.error.message ?? 'Unknown OpenRouter stream error');
	}

	return chunk.choices?.[0]?.delta?.content ?? null;
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
): AsyncGenerator<string> {
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
				const delta = extractDelta(payload);
				if (delta) yield delta;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
