/**
 * Building the context block sent with each request, and sizing it for the
 * indicator. Pure — no React, no Obsidian imports, so it stays testable.
 */

export interface AttachedNote {
	path: string;
	content: string;
}

/** Why a note that was once in context is no longer being sent. */
export type UnavailableReason = 'removed' | 'missing';

export interface UnavailableNote {
	path: string;
	reason: UnavailableReason;
}

const PREAMBLE =
	"Attached notes from the user's Obsidian vault. Treat them as reference material for the conversation.";

const REASON_TEXT: Record<UnavailableReason, string> = {
	removed: 'removed from context by the user',
	missing: 'renamed or deleted in the vault',
};

/**
 * Context is expanded fresh on every request, so a note dropped mid-conversation
 * simply vanishes — leaving earlier replies quoting material that appears
 * nowhere in the request. A model reading that will reasonably conclude it made
 * the material up. This block says plainly that the note existed and is gone.
 */
function unavailableBlock(unavailable: readonly UnavailableNote[]): string {
	const lines = unavailable.map(
		(note) => `- "${note.path}" — ${REASON_TEXT[note.reason]}`,
	);

	return [
		'Some notes were attached earlier in this conversation and are not available now:',
		...lines,
		'Their contents are genuinely absent from this request. Earlier replies that drew on them were working from real notes, not invented detail.',
	].join('\n');
}

/**
 * Wraps each note in explicit delimiters rather than markdown headings, which
 * would collide with headings inside the notes themselves.
 */
export function buildContextBlock(
	notes: readonly AttachedNote[],
	unavailable: readonly UnavailableNote[] = [],
): string {
	if (notes.length === 0 && unavailable.length === 0) return '';

	const sections: string[] = [];

	if (notes.length > 0) {
		sections.push(PREAMBLE);
		for (const note of notes) {
			sections.push(
				`--- BEGIN NOTE: ${note.path} ---\n${note.content}\n--- END NOTE: ${note.path} ---`,
			);
		}
	}

	if (unavailable.length > 0) sections.push(unavailableBlock(unavailable));

	return sections.join('\n\n');
}

/**
 * Merges the configured system prompt and the context block into a single
 * system message. One message rather than two: multiple system messages are
 * accepted unevenly across providers.
 *
 * Returns null when there is nothing to send, so the caller can omit the
 * message entirely instead of sending an empty one.
 */
export function buildSystemMessage(
	systemPrompt: string,
	contextBlock: string,
): string | null {
	const parts = [systemPrompt.trim(), contextBlock.trim()].filter(
		(part) => part !== '',
	);
	return parts.length === 0 ? null : parts.join('\n\n');
}

/**
 * Rough size estimate for the indicator. Around four characters per token
 * holds for English prose; this is deliberately approximate (SPEC §4.2) and
 * is never used to gate a request.
 */
export function estimateTokens(characters: number): number {
	return Math.ceil(characters / 4);
}

/** Compact display number: 812, 4.2k, 1.3M. */
export function formatApprox(value: number): string {
	if (value < 1000) return String(value);
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * Pulls vault paths out of dropped text. Obsidian's file explorer hands over
 * wikilinks, markdown links or bare paths depending on settings, and dropping
 * a multi-selection yields one per line.
 */
export function parseDropText(text: string): string[] {
	const paths: string[] = [];

	for (const rawLine of text.split('\n')) {
		let line = rawLine.trim();
		if (line === '') continue;

		// Embeds arrive as ![[Note]].
		if (line.startsWith('!')) line = line.slice(1).trim();

		const wikilink = /^\[\[(.+?)\]\]$/.exec(line);
		if (wikilink?.[1] !== undefined) {
			// Drop any |display alias and #heading or #^block reference.
			const target = wikilink[1].split('|')[0]?.split('#')[0]?.trim();
			if (target !== undefined && target !== '') paths.push(target);
			continue;
		}

		const markdownLink = /^\[.*?\]\((.+?)\)$/.exec(line);
		if (markdownLink?.[1] !== undefined) {
			const target = decodeUriComponentSafe(markdownLink[1])
				.split('#')[0]
				?.trim();
			if (target !== undefined && target !== '') paths.push(target);
			continue;
		}

		paths.push(line);
	}

	return paths;
}

function decodeUriComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
