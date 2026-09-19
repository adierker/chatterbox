import {
	ChatMessage,
	ChatMeta,
	ChatParameters,
	ReasoningEffort,
	Transcript,
} from './types';
import { ALL_EFFORTS } from './parameters';

/**
 * Chat file format (SPEC §7). Frontmatter for metadata, HTML comments as
 * message delimiters — invisible in reading view, unambiguous to parse, and
 * they do not collide with headings inside the conversation.
 *
 * Pure: no Obsidian imports, so the round-trip requirement can be tested.
 * The frontmatter reader/writer is deliberately a small fixed schema rather
 * than general YAML, which is what makes an exact round trip possible.
 */

export class TranscriptError extends Error {}

const DELIMITER = /^<!--msg:([a-z]+)((?:\s+[^\s=]+=(?:"(?:[^"\\]|\\.)*"|\S+))*)\s*-->$/;
const ATTRIBUTE = /([^\s=]+)=("(?:[^"\\]|\\.)*"|\S+)/g;

// Frontmatter is written in the key order shown in SPEC §7, so hand-written
// files and generated ones look the same.

// ---------------------------------------------------------------- serialize

function quote(value: string): string {
	// JSON strings are valid YAML double-quoted scalars, and they survive
	// newlines and quotes without any format of our own.
	return JSON.stringify(value);
}

function parameterLines(parameters: ChatParameters): string[] {
	const lines: string[] = [];
	if (parameters.temperature !== undefined) {
		lines.push(`temperature: ${String(parameters.temperature)}`);
	}
	if (parameters.topP !== undefined) {
		lines.push(`top_p: ${String(parameters.topP)}`);
	}
	if (parameters.maxTokens !== undefined) {
		lines.push(`max_tokens: ${String(parameters.maxTokens)}`);
	}
	if (parameters.reasoning !== undefined) {
		lines.push(`reasoning: ${String(parameters.reasoning)}`);
	}
	if (parameters.reasoningEffort !== undefined) {
		lines.push(`reasoning_effort: ${parameters.reasoningEffort}`);
	}
	if (parameters.webSearch !== undefined) {
		lines.push(`web_search: ${String(parameters.webSearch)}`);
	}
	return lines;
}

function serializeFrontmatter(meta: ChatMeta): string {
	const lines: string[] = [`model: ${quote(meta.model)}`];

	lines.push(...parameterLines(meta.parameters));

	if (meta.systemPrompt !== null) {
		lines.push(`system_prompt: ${quote(meta.systemPrompt)}`);
	}
	if (meta.context.length > 0) {
		lines.push('context:');
		for (const path of meta.context) lines.push(`  - ${quote(path)}`);
	}
	if (meta.removedContext.length > 0) {
		lines.push('removed_context:');
		for (const path of meta.removedContext) lines.push(`  - ${quote(path)}`);
	}
	lines.push(`created: ${meta.created}`);
	if (meta.forkedFrom !== null) {
		lines.push(`forked_from: ${quote(meta.forkedFrom)}`);
	}
	if (meta.forkedAt !== null) {
		lines.push(`forked_at: ${String(meta.forkedAt)}`);
	}
	lines.push(...meta.unknown);

	return `---\n${lines.join('\n')}\n---`;
}

function serializeAttributes(message: ChatMessage): string {
	const attributes: string[] = [`id=${message.id}`];

	if (message.model !== undefined) attributes.push(`model=${message.model}`);
	if (message.edited === true) attributes.push('edited=true');

	const parameters = message.parameters ?? {};
	if (parameters.temperature !== undefined) {
		attributes.push(`temperature=${String(parameters.temperature)}`);
	}
	if (parameters.topP !== undefined) {
		attributes.push(`top_p=${String(parameters.topP)}`);
	}
	if (parameters.maxTokens !== undefined) {
		attributes.push(`max_tokens=${String(parameters.maxTokens)}`);
	}
	if (parameters.reasoning !== undefined) {
		attributes.push(`reasoning=${String(parameters.reasoning)}`);
	}
	if (parameters.reasoningEffort !== undefined) {
		attributes.push(`reasoning_effort=${parameters.reasoningEffort}`);
	}
	if (parameters.webSearch !== undefined) {
		attributes.push(`web_search=${String(parameters.webSearch)}`);
	}

	return attributes
		.map((attribute) => (/\s/.test(attribute) ? quote(attribute) : attribute))
		.join(' ');
}

export function serializeTranscript(transcript: Transcript): string {
	const blocks = transcript.messages.map((message) => {
		const content = message.content.trim();

		// Refuse to write a file that would not parse back. Silent corruption
		// of a transcript is the one failure this plugin must never have.
		if (DELIMITER.test(content) || content.split('\n').some(isDelimiter)) {
			throw new TranscriptError(
				`Message ${message.id} contains a line that looks like a message delimiter, which would corrupt the transcript.`,
			);
		}

		return `<!--msg:${message.role} ${serializeAttributes(message)}-->\n\n${content}`;
	});

	return `${serializeFrontmatter(transcript.meta)}\n\n${blocks.join('\n\n')}\n`;
}

// -------------------------------------------------------------------- parse

function isDelimiter(line: string): boolean {
	return DELIMITER.test(line.trim());
}

function unquote(raw: string): string {
	const value = raw.trim();
	if (!value.startsWith('"')) return value;
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === 'string' ? parsed : value;
	} catch {
		return value;
	}
}

function parseNumber(raw: string, key: string): number {
	const value = Number(unquote(raw));
	if (!Number.isFinite(value)) {
		throw new TranscriptError(`${key} must be a number, found "${raw}".`);
	}
	return value;
}

function parseBoolean(raw: string, key: string): boolean {
	const value = unquote(raw).toLowerCase();
	if (value === 'true') return true;
	if (value === 'false') return false;
	throw new TranscriptError(`${key} must be true or false, found "${raw}".`);
}

function parseEffort(raw: string, key: string): ReasoningEffort {
	const value = unquote(raw).toLowerCase();
	if ((ALL_EFFORTS as readonly string[]).includes(value)) {
		return value as ReasoningEffort;
	}
	throw new TranscriptError(
		`${key} must be one of ${ALL_EFFORTS.join(', ')}; found "${raw}".`,
	);
}

function applyParameter(
	parameters: ChatParameters,
	key: string,
	raw: string,
): boolean {
	switch (key) {
		case 'temperature':
			parameters.temperature = parseNumber(raw, key);
			return true;
		case 'top_p':
			parameters.topP = parseNumber(raw, key);
			return true;
		case 'max_tokens':
			parameters.maxTokens = parseNumber(raw, key);
			return true;
		case 'reasoning':
			parameters.reasoning = parseBoolean(raw, key);
			return true;
		case 'reasoning_effort':
			parameters.reasoningEffort = parseEffort(raw, key);
			return true;
		case 'web_search':
			parameters.webSearch = parseBoolean(raw, key);
			return true;
		default:
			return false;
	}
}

function parseFrontmatter(block: string): ChatMeta {
	const meta: ChatMeta = {
		model: '',
		systemPrompt: null,
		context: [],
		removedContext: [],
		created: '',
		forkedFrom: null,
		forkedAt: null,
		parameters: {},
		unknown: [],
	};

	const lines = block.split('\n');
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		index += 1;

		if (line.trim() === '') continue;

		const separator = line.indexOf(':');
		if (separator === -1) {
			throw new TranscriptError(`Unreadable frontmatter line: "${line}".`);
		}

		const key = line.slice(0, separator).trim();
		const raw = line.slice(separator + 1).trim();

		if (key === 'context' || key === 'removed_context') {
			// A YAML list: subsequent "  - value" lines.
			const target =
				key === 'context' ? meta.context : meta.removedContext;
			while (index < lines.length && /^\s*-\s/.test(lines[index] ?? '')) {
				const item = (lines[index] ?? '').replace(/^\s*-\s*/, '');
				target.push(unquote(item));
				index += 1;
			}
			continue;
		}

		if (applyParameter(meta.parameters, key, raw)) continue;

		switch (key) {
			case 'model':
				meta.model = unquote(raw);
				break;
			case 'system_prompt':
				meta.systemPrompt = unquote(raw);
				break;
			case 'created':
				meta.created = unquote(raw);
				break;
			case 'forked_from':
				meta.forkedFrom = unquote(raw);
				break;
			case 'forked_at':
				meta.forkedAt = parseNumber(raw, key);
				break;
			default:
				// Not ours. Keep it verbatim rather than dropping it on save.
				meta.unknown.push(line);
				break;
		}
	}

	if (meta.model === '') {
		throw new TranscriptError('Frontmatter is missing a model.');
	}

	return meta;
}

function parseAttributes(raw: string): {
	id: string;
	model?: string;
	parameters: ChatParameters;
	edited: boolean;
} {
	let id = '';
	let model: string | undefined;
	let edited = false;
	const parameters: ChatParameters = {};

	for (const match of raw.matchAll(ATTRIBUTE)) {
		const key = match[1] ?? '';
		const value = unquote(match[2] ?? '');

		if (key === 'id') {
			id = value;
		} else if (key === 'model') {
			model = value;
		} else if (key === 'edited') {
			edited = parseBoolean(value, key);
		} else if (!applyParameter(parameters, key, value)) {
			throw new TranscriptError(
				`Unrecognised attribute "${key}" on a message delimiter.`,
			);
		}
	}

	if (id === '') {
		throw new TranscriptError('A message delimiter is missing its id.');
	}

	return {
		id,
		parameters,
		edited,
		...(model === undefined ? {} : { model }),
	};
}

/**
 * @throws TranscriptError on anything it cannot read. Failing loudly is
 * required (SPEC §7): silently dropping a turn is worse than not opening.
 */
export function parseTranscript(text: string): Transcript {
	const normalized = text.replace(/\r\n/g, '\n');

	if (!normalized.startsWith('---\n')) {
		throw new TranscriptError('File does not start with frontmatter.');
	}

	const close = normalized.indexOf('\n---', 3);
	if (close === -1) {
		throw new TranscriptError('Frontmatter is never closed.');
	}

	const meta = parseFrontmatter(normalized.slice(4, close + 1));
	const body = normalized.slice(close + 4);

	const messages: ChatMessage[] = [];
	const lines = body.split('\n');
	let current: ChatMessage | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (!current) return;
		current.content = buffer.join('\n').trim();
		messages.push(current);
		buffer = [];
	};

	for (const line of lines) {
		const match = DELIMITER.exec(line.trim());

		if (match) {
			flush();

			const role = match[1] ?? '';
			if (role !== 'user' && role !== 'assistant') {
				throw new TranscriptError(
					`Unknown message role "${role}". Expected user or assistant.`,
				);
			}

			const { id, model, parameters, edited } = parseAttributes(
				match[2] ?? '',
			);
			current = {
				id,
				role,
				content: '',
				...(model === undefined ? {} : { model }),
				...(Object.keys(parameters).length === 0 ? {} : { parameters }),
				...(edited ? { edited: true } : {}),
			};
			continue;
		}

		if (current) {
			buffer.push(line);
			continue;
		}

		// Text before the first delimiter is not part of any message.
		if (line.trim() !== '') {
			throw new TranscriptError(
				`Content found before the first message delimiter: "${line.trim()}".`,
			);
		}
	}

	flush();

	return { meta, messages };
}
