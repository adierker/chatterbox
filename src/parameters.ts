import { ChatParameters, ReasoningEffort } from './types';

/**
 * Parameter rules (SPEC §4.6). Pure, so the range checks and the per-model
 * effort handling are testable without a panel.
 */

export const ALL_EFFORTS: readonly ReasoningEffort[] = [
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
];

/**
 * Which effort levels a model accepts. OpenRouter publishes which *parameters*
 * a model takes but not which effort *values*, so this is configured by hand
 * and lives in settings rather than in code — a provider changing its tiers
 * should be a one-line edit, not a release.
 */
export type EffortOptions = Record<string, ReasoningEffort[]>;

export function effortOptionsFor(
	model: string,
	configured: EffortOptions,
): readonly ReasoningEffort[] {
	const listed = configured[model];
	return listed !== undefined && listed.length > 0 ? listed : ALL_EFFORTS;
}

function isEffort(value: string): value is ReasoningEffort {
	return (ALL_EFFORTS as readonly string[]).includes(value);
}

/** Settings format: one `model = effort, effort` line per model. */
export function parseEffortOptions(text: string): EffortOptions {
	const options: EffortOptions = {};

	for (const line of text.split('\n')) {
		const separator = line.indexOf('=');
		if (separator === -1) continue;

		const model = line.slice(0, separator).trim();
		if (model === '') continue;

		const efforts = line
			.slice(separator + 1)
			.split(',')
			.map((entry) => entry.trim().toLowerCase())
			.filter(isEffort);

		if (efforts.length > 0) options[model] = efforts;
	}

	return options;
}

export function serializeEffortOptions(options: EffortOptions): string {
	return Object.entries(options)
		.map(([model, efforts]) => `${model} = ${efforts.join(', ')}`)
		.join('\n');
}

export interface ParameterIssue {
	field: string;
	message: string;
}

/** Refuses obviously invalid values rather than letting the API reject them. */
export function validateParameters(
	parameters: ChatParameters,
): ParameterIssue[] {
	const issues: ParameterIssue[] = [];

	const { temperature, topP, maxTokens } = parameters;

	if (temperature !== undefined && !(temperature >= 0 && temperature <= 2)) {
		issues.push({
			field: 'temperature',
			message: 'Temperature must be between 0 and 2.',
		});
	}
	if (topP !== undefined && !(topP > 0 && topP <= 1)) {
		issues.push({
			field: 'topP',
			message: 'Top P must be greater than 0 and at most 1.',
		});
	}
	if (
		maxTokens !== undefined &&
		!(Number.isInteger(maxTokens) && maxTokens >= 1)
	) {
		issues.push({
			field: 'maxTokens',
			message: 'Token limit must be a whole number of at least 1.',
		});
	}

	return issues;
}

/**
 * Keeps the selected effort legal for the current model. Switching models is
 * a normal move mid-conversation, and it must not silently leave an effort
 * the new model will reject.
 */
export function reconcileEffort(
	parameters: ChatParameters,
	allowed: readonly ReasoningEffort[],
): ChatParameters {
	const { reasoningEffort } = parameters;
	if (reasoningEffort === undefined || allowed.includes(reasoningEffort)) {
		return parameters;
	}
	return { ...parameters, reasoningEffort: allowed[0] };
}

/** New chats start from the global defaults (SPEC §4.6). */
export function withDefaults(defaults: ChatParameters): ChatParameters {
	return { ...defaults };
}
