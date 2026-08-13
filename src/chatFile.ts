import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { Transcript } from './types';
import { parseTranscript, serializeTranscript } from './transcript';
import { deriveTitle, forkTitle, uniqueTitle } from './titles';

export interface ChatSummary {
	file: TFile;
	title: string;
	modified: number;
	forkedFrom: string | null;
}

function folderPath(folder: string): string {
	return normalizePath(folder.replace(/\/+$/, ''));
}

export function chatPath(folder: string, title: string): string {
	return normalizePath(`${folderPath(folder)}/${title}.md`);
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = folderPath(folder);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing) {
		throw new Error(`${path} exists but is not a folder.`);
	}
	await app.vault.createFolder(path);
}

/** True when a file lives in the chat folder, i.e. is a transcript. */
export function isChatFile(file: TFile, folder: string): boolean {
	return file.path.startsWith(`${folderPath(folder)}/`);
}

export function listChatFiles(app: App, folder: string): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter((file) => isChatFile(file, folder));
}

/** Most recent first (SPEC §4.5). Unreadable files are listed, not hidden. */
export function listChats(app: App, folder: string): ChatSummary[] {
	return listChatFiles(app, folder)
		.map((file) => ({
			file,
			title: file.basename,
			modified: file.stat.mtime,
			forkedFrom: forkParentOf(app, file),
		}))
		.sort((a, b) => b.modified - a.modified);
}

/**
 * Reads the fork parent from the metadata cache rather than parsing the file,
 * so building the history list stays cheap.
 */
function forkParentOf(app: App, file: TFile): string | null {
	const frontmatter: Record<string, unknown> =
		app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const value = frontmatter['forked_from'];
	return typeof value === 'string' ? value : null;
}

export async function loadChat(app: App, file: TFile): Promise<Transcript> {
	return parseTranscript(await app.vault.read(file));
}

/**
 * Writes a chat, creating the file on first save. Returns the file so the
 * caller can track which chat is active.
 */
export async function saveChat(
	app: App,
	folder: string,
	existing: TFile | null,
	transcript: Transcript,
): Promise<TFile> {
	// Serialize before touching the vault: a transcript that cannot be written
	// safely must not truncate the file that is already on disk.
	const contents = serializeTranscript(transcript);

	if (existing) {
		await app.vault.modify(existing, contents);
		return existing;
	}

	await ensureFolder(app, folder);

	const firstUser = transcript.messages.find(
		(message) => message.role === 'user',
	);
	const taken = new Set(listChatFiles(app, folder).map((f) => f.basename));
	const title = uniqueTitle(deriveTitle(firstUser?.content ?? ''), taken);

	return app.vault.create(chatPath(folder, title), contents);
}

/**
 * Writes a fork as a new file beside its parent. The parent is not touched —
 * the caller is responsible for having flushed it intact first (SPEC §4.4).
 */
export async function forkChat(
	app: App,
	folder: string,
	parent: TFile,
	transcript: Transcript,
): Promise<TFile> {
	// Serialize before creating anything, so a transcript that cannot be
	// written safely leaves no half-made file behind.
	const contents = serializeTranscript(transcript);

	await ensureFolder(app, folder);
	const taken = new Set(listChatFiles(app, folder).map((f) => f.basename));

	return app.vault.create(
		chatPath(folder, forkTitle(parent.basename, taken)),
		contents,
	);
}

/** Uses the trash preference rather than a permanent unlink (SPEC §4.5). */
export async function deleteChat(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}

export async function renameChat(
	app: App,
	file: TFile,
	title: string,
): Promise<void> {
	const taken = new Set(
		listChatFiles(app, file.parent?.path ?? '')
			.filter((other) => other.path !== file.path)
			.map((other) => other.basename),
	);
	const folder = file.parent?.path ?? '';
	await app.fileManager.renameFile(
		file,
		chatPath(folder, uniqueTitle(title, taken)),
	);
}
