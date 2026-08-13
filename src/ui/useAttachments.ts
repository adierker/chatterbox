import { useCallback, useEffect, useMemo, useState } from 'react';
import type { App } from 'obsidian';
import { estimateTokens } from '../context';
import { resolveAttachment } from '../vault';

export interface AttachmentSize {
	notes: number;
	characters: number;
	approxTokens: number;
}

export interface Attachments {
	paths: string[];
	/** Attached paths that no longer resolve — surfaced as a warning (SPEC §4.2). */
	missing: string[];
	size: AttachmentSize;
	attach: (paths: readonly string[]) => void;
	detach: (path: string) => void;
	clear: () => void;
	/** Replaces the whole set — used when loading a chat from history. */
	replace: (paths: readonly string[]) => void;
}

/**
 * Chat-level attachment set: one tray for the whole conversation, sent with
 * every request until it changes.
 */
export function useAttachments(app: App): Attachments {
	const [paths, setPaths] = useState<string[]>([]);
	// Bumped by vault events so sizes and missing-file warnings stay current
	// while a note is edited, renamed or deleted underneath the panel.
	const [vaultRevision, setVaultRevision] = useState(0);

	useEffect(() => {
		const bump = () => {
			setVaultRevision((revision) => revision + 1);
		};
		const refs = [
			app.vault.on('modify', bump),
			app.vault.on('rename', bump),
			app.vault.on('delete', bump),
			app.vault.on('create', bump),
		];
		return () => {
			for (const ref of refs) app.vault.offref(ref);
		};
	}, [app]);

	const { missing, size } = useMemo(() => {
		void vaultRevision;

		const absent: string[] = [];
		let characters = 0;

		for (const path of paths) {
			const file = resolveAttachment(app, path);
			if (file) {
				// stat.size is bytes, close enough to characters for prose and
				// far cheaper than reading every file on every keystroke.
				characters += file.stat.size;
			} else {
				absent.push(path);
			}
		}

		return {
			missing: absent,
			size: {
				notes: paths.length - absent.length,
				characters,
				approxTokens: estimateTokens(characters),
			},
		};
	}, [app, paths, vaultRevision]);

	const attach = useCallback((incoming: readonly string[]) => {
		setPaths((previous) => {
			const merged = [...previous];
			for (const path of incoming) {
				if (!merged.includes(path)) merged.push(path);
			}
			return merged;
		});
	}, []);

	const detach = useCallback((path: string) => {
		setPaths((previous) => previous.filter((entry) => entry !== path));
	}, []);

	const clear = useCallback(() => {
		setPaths([]);
	}, []);

	const replace = useCallback((incoming: readonly string[]) => {
		setPaths([...incoming]);
	}, []);

	return { paths, missing, size, attach, detach, clear, replace };
}
