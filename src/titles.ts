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

/** YY-MM-DD, so the folder sorts chronologically rather than by whatever the
 * first message happened to say. */
const DATE_PREFIX = /^\d{2}-\d{2}-\d{2} /;

export function datePrefix(date: Date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `;
}

export function stripDatePrefix(title: string): string {
	return title.replace(DATE_PREFIX, '');
}

/** The prefix a file already carries, or '' if it predates them. */
export function existingDatePrefix(title: string): string {
	return DATE_PREFIX.exec(title)?.[0] ?? '';
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
	prefix = '',
): string {
	// The parent's date is dropped: a fork is dated when it diverged, not when
	// the conversation it came from started.
	const stem = stripDatePrefix(parentTitle);
	const match = FORK_SUFFIX.exec(stem);
	const base = match?.[1] ?? stem;
	const start = match?.[2] === undefined ? 2 : Number(match[2]) + 1;

	for (let counter = start; ; counter += 1) {
		const candidate = `${prefix}${base} (fork ${String(counter)})`;
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
