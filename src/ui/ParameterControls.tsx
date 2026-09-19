import { ChatParameters, ReasoningEffort } from '../types';
import { effortOptionsFor, EffortOptions } from '../parameters';

interface ParameterControlsProps {
	parameters: ChatParameters;
	/** Per-chat system prompt. Omitted in the message editor. */
	systemPrompt?: string;
	onSystemPromptChange?: (prompt: string) => void;
	model: string;
	effortOptions: EffortOptions;
	onChange: (parameters: ChatParameters) => void;
	onRestoreDefaults: () => void;
	onClear: () => void;
}

/**
 * Per-chat generation settings (SPEC §4.6). A blank field is unset and is
 * omitted from the request rather than sent as a default.
 */
export function ParameterControls({
	parameters,
	systemPrompt,
	onSystemPromptChange,
	model,
	effortOptions,
	onChange,
	onRestoreDefaults,
	onClear,
}: ParameterControlsProps) {
	const allowed = effortOptionsFor(model, effortOptions);

	const setNumber = (
		key: 'temperature' | 'topP' | 'maxTokens',
		raw: string,
	) => {
		const next = { ...parameters };
		const trimmed = raw.trim();

		if (trimmed === '') {
			delete next[key];
		} else {
			const parsed = Number(trimmed);
			if (!Number.isFinite(parsed)) return;
			next[key] = parsed;
		}
		onChange(next);
	};

	const reasoningValue =
		parameters.reasoning === undefined
			? 'default'
			: parameters.reasoning
				? 'on'
				: 'off';

	return (
		<div className="chatterbox-parameters">
			{systemPrompt !== undefined && onSystemPromptChange !== undefined && (
				<label className="chatterbox-param-block">
					<span>
						System prompt{' '}
						<span className="chatterbox-hint">this chat only</span>
					</span>
					<textarea
						className="chatterbox-system-prompt"
						rows={4}
						placeholder="Inherited from settings when a chat starts"
						value={systemPrompt}
						onChange={(event) => {
							onSystemPromptChange(event.target.value);
						}}
					/>
				</label>
			)}

			{/*
			  * step is "any" on the fractional fields: a fixed step makes the
			  * browser reject any value off its grid, so 0.75 would show as
			  * invalid against step 0.1. Ranges are enforced by min/max here
			  * and by validateParameters before sending.
			  */}
			<NumberRow
				label="Temperature"
				hint="0–2"
				value={parameters.temperature}
				min={0}
				max={2}
				step="any"
				onChange={(raw) => {
					setNumber('temperature', raw);
				}}
			/>
			<NumberRow
				label="Top P"
				hint="0–1"
				value={parameters.topP}
				min={0}
				max={1}
				step="any"
				onChange={(raw) => {
					setNumber('topP', raw);
				}}
			/>
			<NumberRow
				label="Token limit"
				hint="whole number"
				value={parameters.maxTokens}
				min={1}
				step={1}
				onChange={(raw) => {
					setNumber('maxTokens', raw);
				}}
			/>

			<label className="chatterbox-param-row">
				<span>Reasoning</span>
				<select
					className="dropdown"
					value={reasoningValue}
					onChange={(event) => {
						const next = { ...parameters };
						if (event.target.value === 'default') {
							delete next.reasoning;
						} else {
							next.reasoning = event.target.value === 'on';
						}
						onChange(next);
					}}
				>
					<option value="default">Model default</option>
					<option value="on">On</option>
					<option value="off">Off</option>
				</select>
			</label>

			<label className="chatterbox-param-row">
				<span>Effort</span>
				<select
					className="dropdown"
					// Disabled rather than hidden, so it stays discoverable.
					disabled={parameters.reasoning !== true}
					value={parameters.reasoningEffort ?? ''}
					onChange={(event) => {
						const next = { ...parameters };
						if (event.target.value === '') {
							delete next.reasoningEffort;
						} else {
							next.reasoningEffort = event.target
								.value as ReasoningEffort;
						}
						onChange(next);
					}}
				>
					<option value="">Provider default</option>
					{allowed.map((effort) => (
						<option key={effort} value={effort}>
							{effort}
						</option>
					))}
				</select>
			</label>

			{/*
			  * Two states, unlike Reasoning: OpenRouter has no "provider
			  * default" for search, and pulling in material the author did not
			  * attach should never happen by omission.
			  */}
			<label className="chatterbox-param-row">
				<span>
					Web search{' '}
					<span className="chatterbox-hint">costs per request</span>
				</span>
				<select
					className="dropdown"
					value={parameters.webSearch === true ? 'on' : 'off'}
					onChange={(event) => {
						const next = { ...parameters };
						if (event.target.value === 'on') {
							next.webSearch = true;
						} else {
							delete next.webSearch;
						}
						onChange(next);
					}}
				>
					<option value="off">Off</option>
					<option value="on">On</option>
				</select>
			</label>

			<div className="chatterbox-param-footer">
				<span className="chatterbox-hint">
					Applies to this chat. Blank is omitted.
				</span>
				<span className="chatterbox-param-actions">
					<button
						onClick={onClear}
						title="Unset every field, so only the model is sent"
					>
						Clear all
					</button>
					<button
						onClick={onRestoreDefaults}
						title="Restore the system prompt and values configured in plugin settings"
					>
						Restore defaults
					</button>
				</span>
			</div>
		</div>
	);
}

function NumberRow({
	label,
	hint,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	hint: string;
	value: number | undefined;
	min?: number;
	max?: number;
	step: number | 'any';
	onChange: (raw: string) => void;
}) {
	return (
		<label className="chatterbox-param-row">
			<span>
				{label} <span className="chatterbox-hint">{hint}</span>
			</span>
			<input
				type="number"
				min={min}
				max={max}
				step={step}
				placeholder="unset"
				value={value === undefined ? '' : String(value)}
				onChange={(event) => {
					onChange(event.target.value);
				}}
			/>
		</label>
	);
}
