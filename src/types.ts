export type Role = 'user' | 'assistant';

/**
 * OpenRouter's effort levels. Wider than SPEC §4.6's low/medium/high because
 * the models actually in use accept values outside that range — GLM takes
 * xhigh, Kimi takes max. Which subset a given model accepts is not published
 * anywhere, so it is configured per model in settings.
 */
export type ReasoningEffort =
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'xhigh'
	| 'max';

/**
 * Generation settings. Every field is optional on purpose: unset means the
 * parameter is omitted from the request entirely rather than sent as a
 * default, because some models reject parameters they do not support
 * (SPEC §4.6). Which subset a model accepts varies, so nothing is sent unless
 * it has been set explicitly.
 */
export interface ChatParameters {
	temperature?: number;
	topP?: number;
	maxTokens?: number;
	/**
	 * Three states, not two. Unset sends nothing and leaves the provider to
	 * decide; true enables reasoning; false disables it explicitly. Omitting
	 * the field is not the same as switching reasoning off on a model that
	 * reasons by default.
	 */
	reasoning?: boolean;
	reasoningEffort?: ReasoningEffort;
}

export interface ChatMessage {
	id: string;
	role: Role;
	content: string;
	/** Model that produced this text. Set on assistant messages only. */
	model?: string;
	/**
	 * Parameters in effect when this text was produced. Stamped per message so
	 * changing settings mid-chat does not rewrite the history of what actually
	 * generated the earlier responses (SPEC §10 Q6).
	 */
	parameters?: ChatParameters;
	/**
	 * Set when the user rewrote an assistant message, so the transcript never
	 * implies the model produced that text (SPEC §10 Q5).
	 */
	edited?: boolean;
}

/** Everything about a chat that is not the messages themselves. */
export interface ChatMeta {
	model: string;
	systemPrompt: string | null;
	/** Vault paths of attached notes. References, never copies (SPEC §4.2). */
	context: string[];
	/**
	 * Notes that were sent earlier in this conversation and have since been
	 * removed. Kept so the model can be told they existed rather than left to
	 * conclude it invented whatever the earlier replies drew from them.
	 */
	removedContext: string[];
	created: string;
	forkedFrom: string | null;
	forkedAt: number | null;
	parameters: ChatParameters;
	/**
	 * Frontmatter lines this plugin does not recognise, kept verbatim so that
	 * saving a hand-edited file never discards the author's own keys.
	 */
	unknown: string[];
}

export interface Transcript {
	meta: ChatMeta;
	messages: ChatMessage[];
}
