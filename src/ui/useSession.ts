import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Notice, TFile } from 'obsidian';
import type ChatterboxPlugin from '../main';
import { ChatMessage, ChatParameters, Transcript } from '../types';
import {
	effortOptionsFor,
	reconcileEffort,
	validateParameters,
	withDefaults,
} from '../parameters';
import { appendContent, appendMessage, createMessage } from '../messages';
import {
	UnavailableNote,
	buildContextBlock,
	buildSystemMessage,
} from '../context';
import { expandAttachments } from '../vault';
import { streamCompletion } from '../openrouter';
import { loadApiKey } from '../settings';
import { forkChat, loadChat, renameChat, saveChat } from '../chatFile';
import { RewindMode, planRewind } from '../rewind';
import { ConfirmModal } from '../confirmModal';
import { AttachmentSize, useAttachments } from './useAttachments';

/**
 * The attachment tray's view of the world: what is attached, what has already
 * been sent (and so cannot be dropped without explanation), and what used to
 * be here.
 */
export interface ContextState {
	paths: string[];
	missing: string[];
	size: AttachmentSize;
	sent: ReadonlySet<string>;
	unavailable: UnavailableNote[];
	/**
	 * Counts explicit attach actions only. Loading a chat replaces the whole
	 * set without touching this, so the UI can tell "the user just attached
	 * something" from "a different conversation was opened".
	 */
	attachSeq: number;
	attach: (paths: readonly string[]) => void;
	remove: (path: string) => void;
}

export interface RewindRequest {
	messageId: string;
	mode: RewindMode;
	/** New text, or undefined to resend the message unchanged. */
	content?: string;
	/** Model to use from here on; defaults to the current one. */
	model?: string;
	parameters?: ChatParameters;
}

export interface Session {
	messages: ChatMessage[];
	streamingId: string | null;
	model: string;
	setModel: (model: string) => void;
	send: (text: string) => void;
	/** Aborts the in-flight reply, keeping whatever text arrived (SPEC §4.1). */
	stop: () => void;
	/** Last failure, kept on screen until dismissed or superseded. */
	lastError: string | null;
	dismissError: () => void;
	newChat: () => void;
	parameters: ChatParameters;
	setParameters: (parameters: ChatParameters) => void;
	resetParameters: () => void;
	clearParameters: () => void;
	/** Per-chat system prompt (SPEC §4.3), seeded from the global setting. */
	systemPrompt: string;
	setSystemPrompt: (prompt: string) => void;
	context: ContextState;
	rewind: (request: RewindRequest) => void;
	/** File backing this chat, or null before the first exchange is saved. */
	file: TFile | null;
	/** Path of the chat this one was forked from, for the link back. */
	parentPath: string | null;
	open: (file: TFile) => Promise<void>;
}

function nowStamp(): string {
	// Local time, seconds precision, matching the SPEC §7 example.
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, '0');
	return (
		`${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
	);
}

export function useSession(plugin: ChatterboxPlugin): Session {
	const attachments = useAttachments(plugin.app);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [streamingId, setStreamingId] = useState<string | null>(null);
	const [model, setModel] = useState<string>(() => plugin.defaultModel());
	const [file, setFile] = useState<TFile | null>(null);
	const [parentPath, setParentPath] = useState<string | null>(null);
	const [removed, setRemovedState] = useState<string[]>([]);
	const [parameters, setParametersState] = useState<ChatParameters>(() =>
		withDefaults(plugin.settings.defaultParameters),
	);
	const [sent, setSentState] = useState<ReadonlySet<string>>(new Set());
	const [attachSeq, setAttachSeq] = useState(0);
	const [lastError, setLastError] = useState<string | null>(null);
	const [systemPrompt, setSystemPromptState] = useState(
		() => plugin.settings.systemPrompt,
	);

	// Mirrors of state, so the async send loop and the unmount flush never read
	// a stale closure.
	const messagesRef = useRef<ChatMessage[]>([]);
	const abortRef = useRef<AbortController | null>(null);
	const fileRef = useRef<TFile | null>(null);
	const removedRef = useRef<string[]>([]);
	const sentRef = useRef<Set<string>>(new Set());
	const dirtyRef = useRef(false);
	const attachmentsRef = useRef<readonly string[]>([]);
	const modelRef = useRef(model);
	const parametersRef = useRef<ChatParameters>(parameters);
	const systemPromptRef = useRef(systemPrompt);
	const metaRef = useRef<{
		created: string;
		forkedFrom: string | null;
		forkedAt: number | null;
		unknown: string[];
	}>({
		created: nowStamp(),
		forkedFrom: null,
		forkedAt: null,
		unknown: [],
	});

	attachmentsRef.current = attachments.paths;
	modelRef.current = model;
	parametersRef.current = parameters;
	systemPromptRef.current = systemPrompt;

	const update = useCallback(
		(change: (previous: ChatMessage[]) => ChatMessage[]) => {
			messagesRef.current = change(messagesRef.current);
			setMessages(messagesRef.current);
		},
		[],
	);

	const setRemoved = useCallback((paths: string[]) => {
		removedRef.current = paths;
		setRemovedState(paths);
	}, []);

	const markSent = useCallback((paths: readonly string[]) => {
		let changed = false;
		for (const path of paths) {
			if (!sentRef.current.has(path)) {
				sentRef.current.add(path);
				changed = true;
			}
		}
		if (changed) setSentState(new Set(sentRef.current));
	}, []);

	/**
	 * Notes the conversation has seen that are not in this request: dropped by
	 * the user, or gone from the vault. Only notes that were actually sent
	 * matter — nothing in the history refers to the others.
	 */
	const unavailableNow = useCallback((): UnavailableNote[] => {
		const gone: UnavailableNote[] = removedRef.current.map((path) => ({
			path,
			reason: 'removed' as const,
		}));

		for (const path of attachments.missing) {
			if (sentRef.current.has(path)) {
				gone.push({ path, reason: 'missing' });
			}
		}

		return gone;
	}, [attachments.missing]);

	const buildTranscript = useCallback((): Transcript => {
		const prompt = systemPromptRef.current.trim();
		return {
			meta: {
				model: modelRef.current,
				systemPrompt: prompt === '' ? null : prompt,
				context: [...attachmentsRef.current],
				removedContext: [...removedRef.current],
				created: metaRef.current.created,
				forkedFrom: metaRef.current.forkedFrom,
				forkedAt: metaRef.current.forkedAt,
				parameters: parametersRef.current,
				unknown: metaRef.current.unknown,
			},
			messages: messagesRef.current,
		};
	}, [plugin]);

	const persist = useCallback(async () => {
		if (messagesRef.current.length === 0) return;
		try {
			const saved = await saveChat(
				plugin.app,
				plugin.settings.chatFolder,
				fileRef.current,
				buildTranscript(),
			);
			fileRef.current = saved;
			setFile(saved);
			dirtyRef.current = false;
			await plugin.rememberActiveChat(saved.path);
		} catch (error) {
			new Notice(
				`Chatterbox: could not save this chat — ${error instanceof Error ? error.message : String(error)}`,
				10000,
			);
		}
	}, [plugin, buildTranscript]);

	// Abort in flight work and flush anything unsaved when the panel closes or
	// the plugin unloads (SPEC §4.5).
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			if (dirtyRef.current) void persist();
		};
	}, [persist]);

	const open = useCallback(
		async (target: TFile) => {
			abortRef.current?.abort();
			abortRef.current = null;
			setStreamingId(null);

			try {
				const transcript = await loadChat(plugin.app, target);

				metaRef.current = {
					created: transcript.meta.created,
					forkedFrom: transcript.meta.forkedFrom,
					forkedAt: transcript.meta.forkedAt,
					unknown: transcript.meta.unknown,
				};
				parametersRef.current = transcript.meta.parameters;
				setParametersState(transcript.meta.parameters);
				// Restoring this is what stops the next save from overwriting
				// the prompt this conversation was actually run with.
				systemPromptRef.current = transcript.meta.systemPrompt ?? '';
				setSystemPromptState(transcript.meta.systemPrompt ?? '');
				setParentPath(transcript.meta.forkedFrom);
				update(() => transcript.messages);
				attachments.replace(transcript.meta.context);
				setRemoved([...transcript.meta.removedContext]);

				// A saved chat with messages has already sent whatever it had
				// attached, so all of it counts as sent on reload.
				sentRef.current = new Set(
					transcript.messages.length > 0 ? transcript.meta.context : [],
				);
				setSentState(new Set(sentRef.current));

				setModel(transcript.meta.model);
				modelRef.current = transcript.meta.model;
				fileRef.current = target;
				setFile(target);
				// Loading must not mutate the file (SPEC §4.5).
				dirtyRef.current = false;
				await plugin.rememberActiveChat(target.path);
			} catch (error) {
				new Notice(
					`Chatterbox: ${target.basename} could not be read — ${error instanceof Error ? error.message : String(error)}`,
					15000,
				);
			}
		},
		[plugin, attachments, update, setRemoved],
	);

	const maybeGenerateTitle = useCallback(async () => {
		if (!plugin.settings.autoGenerateTitles) return;
		const target = fileRef.current;
		if (!target || messagesRef.current.length !== 2) return;

		try {
			const title = await plugin.generateTitle(messagesRef.current);
			if (title !== null) await renameChat(plugin.app, target, title);
		} catch {
			// A title is cosmetic; never let it disturb the conversation.
		}
	}, [plugin]);

	/**
	 * Appends an assistant placeholder and streams a reply into it. Shared by
	 * a normal send and by rewind, so both branches behave identically.
	 */
	const requestReply = useCallback(
		async (nextModel: string, nextParameters: ChatParameters) => {
			const apiKey = loadApiKey(plugin.app, plugin.settings);
			if (apiKey === '') {
				new Notice('Chatterbox: add your OpenRouter API key in settings.');
				return;
			}

			setLastError(null);
			const assistant = createMessage('assistant', '', nextModel);
			assistant.parameters = nextParameters;

			const history = [...messagesRef.current];
			update((previous) => appendMessage(previous, assistant));
			dirtyRef.current = true;

			const attached = [...attachmentsRef.current];
			const unavailable = unavailableNow();
			const controller = new AbortController();
			abortRef.current = controller;
			setStreamingId(assistant.id);

			try {
				// Read attachments now, not when they were attached, so the
				// model sees the current draft (SPEC §4.2).
				const { notes } = await expandAttachments(plugin.app, attached);
				markSent(notes.map((note) => note.path));

				const system = buildSystemMessage(
					systemPromptRef.current,
					buildContextBlock(notes, unavailable),
				);

				for await (const delta of streamCompletion({
					apiKey,
					model: nextModel,
					messages: history,
					system,
					parameters: nextParameters,
					signal: controller.signal,
				})) {
					update((previous) =>
						appendContent(previous, assistant.id, delta),
					);
				}

				await persist();
				await maybeGenerateTitle();
			} catch (error) {
				if (controller.signal.aborted) {
					// Partial text is kept; flush it so it is not lost.
					await persist();
					return;
				}

				update((previous) =>
					previous.filter(
						(message) =>
							message.id !== assistant.id ||
							message.content !== '',
					),
				);
				// A Notice disappears; an error that happened while you were
				// looking elsewhere should still be findable afterwards.
				const message =
					error instanceof Error ? error.message : String(error);
				setLastError(message);
				new Notice(`Chatterbox: ${message}`, 10000);
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
					setStreamingId(null);
				}
			}
		},
		[plugin, update, persist, maybeGenerateTitle, markSent, unavailableNow],
	);

	const send = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (trimmed === '' || abortRef.current !== null) return;

			const issues = validateParameters(parametersRef.current);
			if (issues.length > 0) {
				new Notice(
					`Chatterbox: ${issues.map((issue) => issue.message).join(' ')}`,
				);
				return;
			}

			update((previous) =>
				appendMessage(previous, createMessage('user', trimmed)),
			);
			void requestReply(modelRef.current, parametersRef.current);
		},
		[update, requestReply],
	);

	/**
	 * Edit-and-resubmit, and regenerate (SPEC §4.4). The order matters and is
	 * the whole point: the original conversation is written to disk complete
	 * *before* anything is truncated, and the truncation only ever lands in a
	 * new file.
	 */
	const rewind = useCallback(
		(request: RewindRequest) => {
			if (abortRef.current !== null) {
				// A reply arriving mid-edit would land in the wrong branch.
				abortRef.current.abort();
				abortRef.current = null;
				setStreamingId(null);
			}

			let plan;
			try {
				plan = planRewind(
					messagesRef.current,
					request.messageId,
					request.mode,
					request.content,
				);
			} catch (error) {
				new Notice(
					`Chatterbox: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}

			const nextModel = request.model ?? modelRef.current;
			const nextParameters = request.parameters ?? parametersRef.current;

			const issues = validateParameters(nextParameters);
			if (issues.length > 0) {
				new Notice(
					`Chatterbox: ${issues.map((issue) => issue.message).join(' ')}`,
				);
				return;
			}

			const run = async () => {
				if (plan.needsFork) {
					// 1. The original, untruncated, on disk and untouched.
					const parent = await saveChat(
						plugin.app,
						plugin.settings.chatFolder,
						fileRef.current,
						buildTranscript(),
					);

					// 2. The truncated branch as its own file, recording where
					//    it diverged and the settings it is about to use.
					const forked = await forkChat(
						plugin.app,
						plugin.settings.chatFolder,
						parent,
						{
							meta: {
								...buildTranscript().meta,
								model: nextModel,
								parameters: nextParameters,
								forkedFrom: parent.path,
								forkedAt: plan.index,
							},
							messages: plan.messages,
						},
					);

					metaRef.current = {
						...metaRef.current,
						forkedFrom: parent.path,
						forkedAt: plan.index,
					};
					fileRef.current = forked;
					setFile(forked);
					setParentPath(parent.path);
					await plugin.rememberActiveChat(forked.path);
				}

				// 3. Only now does the panel lose anything.
				update(() => plan.messages);
				modelRef.current = nextModel;
				setModel(nextModel);
				parametersRef.current = nextParameters;
				setParametersState(nextParameters);
				dirtyRef.current = true;

				if (!plan.sends) {
					// Editing a reply steers; it does not ask for a new one.
					await persist();
					return;
				}

				await requestReply(nextModel, nextParameters);
			};

			void run().catch((error: unknown) => {
				new Notice(
					`Chatterbox: could not rewind — ${error instanceof Error ? error.message : String(error)}`,
					10000,
				);
			});
		},
		[plugin, update, persist, buildTranscript, requestReply],
	);

	const stop = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const dismissError = useCallback(() => {
		setLastError(null);
	}, []);

	const newChat = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setStreamingId(null);

		if (dirtyRef.current) void persist();

		update(() => []);
		attachments.clear();
		setRemoved([]);
		sentRef.current = new Set();
		setSentState(new Set());
		metaRef.current = {
			created: nowStamp(),
			forkedFrom: null,
			forkedAt: null,
			unknown: [],
		};
		const defaults = withDefaults(plugin.settings.defaultParameters);
		parametersRef.current = defaults;
		setParametersState(defaults);
		systemPromptRef.current = plugin.settings.systemPrompt;
		setSystemPromptState(plugin.settings.systemPrompt);
		fileRef.current = null;
		setFile(null);
		setParentPath(null);
		dirtyRef.current = false;
		setModel(plugin.defaultModel());
		void plugin.rememberActiveChat(null);
	}, [plugin, attachments, update, persist, setRemoved]);

	/**
	 * Changing parameters mid-conversation affects later requests only and
	 * does not fork — forking is for editing message content (SPEC §4.6).
	 */
	const setParameters = useCallback(
		(next: ChatParameters) => {
			const reconciled = reconcileEffort(
				next,
				effortOptionsFor(modelRef.current, plugin.settings.effortOptions),
			);
			parametersRef.current = reconciled;
			setParametersState(reconciled);
			if (messagesRef.current.length > 0) dirtyRef.current = true;
		},
		[plugin],
	);

	/** Back to the global defaults from settings, values and all. */
	const setSystemPrompt = useCallback((prompt: string) => {
		systemPromptRef.current = prompt;
		setSystemPromptState(prompt);
		if (messagesRef.current.length > 0) dirtyRef.current = true;
	}, []);

	const resetParameters = useCallback(() => {
		setParameters(withDefaults(plugin.settings.defaultParameters));
		setSystemPrompt(plugin.settings.systemPrompt);
	}, [plugin, setParameters, setSystemPrompt]);

	/** Everything unset, so nothing but the model is sent. */
	const clearParameters = useCallback(() => {
		setParameters({});
	}, [setParameters]);

	/** Swapping models must not leave an effort the new model will reject. */
	const changeModel = useCallback(
		(next: string) => {
			setModel(next);
			modelRef.current = next;

			const reconciled = reconcileEffort(
				parametersRef.current,
				effortOptionsFor(next, plugin.settings.effortOptions),
			);
			if (reconciled !== parametersRef.current) {
				parametersRef.current = reconciled;
				setParametersState(reconciled);
			}
			if (messagesRef.current.length > 0) dirtyRef.current = true;
		},
		[plugin],
	);

	const attach = useCallback(
		(paths: readonly string[]) => {
			if (paths.length === 0) return;
			attachments.attach(paths);
			setAttachSeq((sequence) => sequence + 1);
			// Re-attaching something clears its tombstone: it is available again.
			const restored = removedRef.current.filter(
				(path) => !paths.includes(path),
			);
			if (restored.length !== removedRef.current.length) {
				setRemoved(restored);
				dirtyRef.current = true;
			}
		},
		[attachments, setRemoved],
	);

	const remove = useCallback(
		(path: string) => {
			// Never sent, so nothing in the conversation refers to it.
			if (!sentRef.current.has(path)) {
				attachments.detach(path);
				return;
			}

			const name = path.split('/').pop() ?? path;
			new ConfirmModal(
				plugin.app,
				'Remove a note already in this conversation',
				`${name} has been sent in this chat. Removing it stops sending its contents. Earlier replies stay as they are, and the model will be told the note was removed rather than left to assume it invented what it drew from it.`,
				'Remove',
				() => {
					attachments.detach(path);
					if (!removedRef.current.includes(path)) {
						setRemoved([...removedRef.current, path]);
					}
					dirtyRef.current = true;
				},
			).open();
		},
		[plugin, attachments, setRemoved],
	);

	// Restore the chat that was open when the panel last closed.
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;

		const last = plugin.settings.lastActiveChat;
		if (last === '') return;

		const target = plugin.app.vault.getAbstractFileByPath(last);
		if (target instanceof TFile) void open(target);
	}, [plugin, open]);

	const context = useMemo<ContextState>(
		() => ({
			paths: attachments.paths,
			missing: attachments.missing,
			size: attachments.size,
			sent,
			attachSeq,
			unavailable: [
				...removed.map((path) => ({
					path,
					reason: 'removed' as const,
				})),
				...attachments.missing
					.filter((path) => sent.has(path))
					.map((path) => ({ path, reason: 'missing' as const })),
			],
			attach,
			remove,
		}),
		[attachments, sent, removed, attachSeq, attach, remove],
	);

	return {
		messages,
		streamingId,
		model,
		setModel: changeModel,
		send,
		stop,
		lastError,
		dismissError,
		newChat,
		parameters,
		setParameters,
		resetParameters,
		clearParameters,
		systemPrompt,
		setSystemPrompt,
		context,
		rewind,
		file,
		parentPath,
		open,
	};
}
