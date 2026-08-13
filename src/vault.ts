import { App, TFile, normalizePath } from 'obsidian';
import { AttachedNote, parseDropText } from './context';

export interface ExpandedContext {
	notes: AttachedNote[];
	/** Attached paths that no longer resolve to a file in the vault. */
	missing: string[];
}

function fileAt(app: App, path: string): TFile | null {
	const file = app.vault.getAbstractFileByPath(normalizePath(path));
	return file instanceof TFile ? file : null;
}

export function resolveAttachment(app: App, path: string): TFile | null {
	return fileAt(app, path);
}

/**
 * Reads the *current* contents of every attached path (SPEC §4.2 stores
 * references, not copies, so resuming an old chat picks up today's draft).
 * Missing files are reported rather than throwing — the rest still sends.
 */
export async function expandAttachments(
	app: App,
	paths: readonly string[],
): Promise<ExpandedContext> {
	const notes: AttachedNote[] = [];
	const missing: string[] = [];

	for (const path of paths) {
		const file = fileAt(app, path);
		if (!file) {
			missing.push(path);
			continue;
		}
		notes.push({ path: file.path, content: await app.vault.cachedRead(file) });
	}

	return { notes, missing };
}

/**
 * Obsidian's drag manager, which holds the file(s) behind an in-app drag.
 * Not part of the public typings, so it is read defensively and only as a
 * fallback for when the drop carries no usable text.
 */
interface DragManagerLike {
	draggable?: { file?: unknown; files?: unknown[] } | null;
}

export function draggedFilePaths(app: App): string[] {
	const draggable = (app as { dragManager?: DragManagerLike }).dragManager
		?.draggable;
	if (!draggable) return [];

	const candidates = draggable.files ?? [draggable.file];
	return candidates
		.filter((entry): entry is TFile => entry instanceof TFile)
		.map((file) => file.path);
}

/**
 * Resolves one dropped string to a vault file. Obsidian hands over a different
 * shape depending on where the drag started, so this tries each in turn:
 * exact path, path missing its extension, link name, obsidian:// URI, an
 * absolute filesystem path, and finally a plain filename match.
 */
function resolveCandidate(app: App, candidate: string): TFile | null {
	const trimmed = candidate.trim();
	if (trimmed === '') return null;

	const direct = fileAt(app, trimmed);
	if (direct) return direct;

	const withExtension = fileAt(app, `${trimmed}.md`);
	if (withExtension) return withExtension;

	const linked = app.metadataCache.getFirstLinkpathDest(trimmed, '');
	if (linked) return linked;

	if (trimmed.startsWith('obsidian://')) {
		const fromUri = fileFromObsidianUri(app, trimmed);
		if (fromUri) return fromUri;
	}

	const files = app.vault.getMarkdownFiles();

	// An absolute path from outside the vault: "/Users/.../Vault/Folder/Note.md".
	if (trimmed.includes('/')) {
		const bySuffix = files.find((file) => trimmed.endsWith(`/${file.path}`));
		if (bySuffix) return bySuffix;
	}

	// Last resort: a bare filename, with or without extension.
	const wanted = trimmed.replace(/\.md$/i, '').toLowerCase();
	return files.find((file) => file.basename.toLowerCase() === wanted) ?? null;
}

function fileFromObsidianUri(app: App, uri: string): TFile | null {
	try {
		const target = new URL(uri).searchParams.get('file');
		if (target === null) return null;
		return (
			fileAt(app, target) ??
			fileAt(app, `${target}.md`) ??
			app.metadataCache.getFirstLinkpathDest(target, '')
		);
	} catch {
		return null;
	}
}

/**
 * Turns dropped text into vault paths. Wikilinks are resolved through the
 * metadata cache so short link names ("Characters") find the right note.
 */
export function resolveDroppedPaths(app: App, text: string): string[] {
	const resolved: string[] = [];

	for (const candidate of parseDropText(text)) {
		const file = resolveCandidate(app, candidate);
		if (file) resolved.push(file.path);
	}

	return resolved;
}

/** Everything the drop carried, logged when nothing resolves. */
export interface DropReport {
	paths: string[];
	types: string[];
	text: string;
	uriList: string;
	fileNames: string[];
	dragManager: string[];
}

/**
 * Resolves a drop through every route Obsidian might have used, in order of
 * reliability, and reports what it saw so a failure is diagnosable.
 */
export function resolveDrop(app: App, transfer: DataTransfer): DropReport {
	const text = transfer.getData('text/plain');
	const uriList = transfer.getData('text/uri-list');
	const fileNames = Array.from(transfer.files).map((file) => file.name);
	const dragManager = draggedFilePaths(app);

	const attempts: string[][] = [
		// The drag manager is the direct source of truth for an in-app drag.
		dragManager,
		text === '' ? [] : resolveDroppedPaths(app, text),
		uriList === '' ? [] : resolveDroppedPaths(app, uriList),
		fileNames
			.map((name) => resolveCandidate(app, name)?.path)
			.filter((path): path is string => path !== undefined),
	];

	const paths = attempts.find((result) => result.length > 0) ?? [];

	return {
		paths: [...new Set(paths)],
		types: Array.from(transfer.types),
		text,
		uriList,
		fileNames,
		dragManager,
	};
}
