/**
 * Chat titles. The filename is the title (there is no separate title field in
 * frontmatter), so these have to produce something both readable and legal as
 * a vault filename. Pure, so the sanitising rules are testable.
 */

const MAX_LENGTH = 60;
export const UNTITLED = 'Untitled chat';

/** Illegal in Obsidian note names, or in filenames on at least one platform. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeTitle(title: string): string {
	const cleaned = title
		.replace(ILLEGAL, '')
		.replace(/\s+/g, ' ')
		// A leading dot hides the file; trailing dots and spaces break Windows.
		.replace(/^\.+/, '')
		.trim()
		.replace(/[. ]+$/, '');

	return cleaned === '' ? UNTITLED : cleaned;
}

/** Derives a chat title from the first user message (SPEC §4.5). */
export function deriveTitle(firstMessage: string): string {
	const firstLine = firstMessage.trim().split('\n')[0] ?? '';
	const collapsed = firstLine.replace(/\s+/g, ' ').trim();

	if (collapsed.length <= MAX_LENGTH) return sanitizeTitle(collapsed);

	// Cut on a word boundary so titles do not end mid-word.
	const clipped = collapsed.slice(0, MAX_LENGTH);
	const lastSpace = clipped.lastIndexOf(' ');
	return sanitizeTitle(lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped);
}

const FORK_SUFFIX = /^(.*) \(fork (\d+)\)$/;

/**
 * Names a fork so it sorts directly under its parent. Forking a fork
 * increments the existing counter rather than nesting, keeping a whole
 * lineage clustered under one base name — exact parentage lives in
 * frontmatter, not the filename.
 */
export function forkTitle(
	parentTitle: string,
	taken: ReadonlySet<string>,
): string {
	const match = FORK_SUFFIX.exec(parentTitle);
	const base = match?.[1] ?? parentTitle;
	const start = match?.[2] === undefined ? 2 : Number(match[2]) + 1;

	for (let counter = start; ; counter += 1) {
		const candidate = `${base} (fork ${String(counter)})`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Appends a counter until the name is free, e.g. "Pacing 2". */
export function uniqueTitle(title: string, taken: ReadonlySet<string>): string {
	if (!taken.has(title)) return title;

	for (let suffix = 2; ; suffix += 1) {
		const candidate = `${title} ${String(suffix)}`;
		if (!taken.has(candidate)) return candidate;
	}
}
