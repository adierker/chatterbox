import { useEffect, useRef } from 'react';
import type ChatterboxPlugin from '../main';
import type { Session } from './useSession';
import { Icon } from './Icon';
import { ContextDrawer } from './ContextDrawer';
import { ParameterControls } from './ParameterControls';

export type Drawer = 'context' | 'parameters' | null;

interface ControlBarProps {
	plugin: ChatterboxPlugin;
	session: Session;
	drawer: Drawer;
	onDrawerChange: (drawer: Drawer) => void;
	onAttach: () => void;
	onHistory: () => void;
	disabled: boolean;
}

/**
 * Label for the generation-settings button. Reasoning is the setting that
 * changes the character of a reply most, so it earns the button face:
 * "default" and "off" are genuinely different states and both need saying.
 */
function reasoningLabel(session: Session): string {
	const { reasoning, reasoningEffort } = session.parameters;
	if (reasoning === false) return 'Off';
	if (reasoning === true) return reasoningEffort ?? 'On';
	return 'Default';
}

/**
 * The single row of controls above the composer. Each control is one click
 * deep — the model is a plain dropdown, and everything else either opens its
 * own drawer or acts immediately. Nothing is nested inside anything else.
 */
export function ControlBar({
	plugin,
	session,
	drawer,
	onDrawerChange,
	onAttach,
	onHistory,
	disabled,
}: ControlBarProps) {
	const { context } = session;
	const lastAttach = useRef(context.attachSeq);

	// Opening the drawer confirms that a drag or a picked file landed. It keys
	// off explicit attach actions, not the note count — otherwise loading a
	// chat with more notes than the last one would spring the drawer open.
	useEffect(() => {
		if (context.attachSeq !== lastAttach.current) {
			lastAttach.current = context.attachSeq;
			onDrawerChange('context');
		}
	}, [context.attachSeq, onDrawerChange]);

	const toggle = (next: Exclude<Drawer, null>) => {
		onDrawerChange(drawer === next ? null : next);
	};

	const contextLabel =
		context.paths.length === 0
			? 'Context'
			: `${String(context.paths.length)} note${context.paths.length === 1 ? '' : 's'}`;

	return (
		<div className="chatterbox-controls">
			{drawer === 'context' && <ContextDrawer context={context} />}

			{drawer === 'parameters' && (
				<div className="chatterbox-drawer">
					<ParameterControls
						parameters={session.parameters}
						systemPrompt={session.systemPrompt}
						onSystemPromptChange={session.setSystemPrompt}
						model={session.model}
						effortOptions={plugin.settings.effortOptions}
						onChange={session.setParameters}
						onRestoreDefaults={session.resetParameters}
						onClear={session.clearParameters}
					/>
				</div>
			)}

			<div className="chatterbox-bar">
				<button
					onClick={onAttach}
					aria-label="Attach a note"
					title="Attach a note"
				>
					<Icon name="plus" fallback="+" />
				</button>

				<button
					className={`chatterbox-tab${drawer === 'context' ? ' chatterbox-active' : ''}`}
					onClick={() => {
						toggle('context');
					}}
					aria-expanded={drawer === 'context'}
					title="Attached notes"
				>
					{contextLabel}
					{context.missing.length > 0 && (
						<span
							className="chatterbox-warning-dot"
							title="A note is missing"
						>
							!
						</span>
					)}
				</button>

				<select
					className="dropdown chatterbox-model"
					value={session.model}
					disabled={disabled}
					title={session.model}
					onChange={(event) => {
						session.setModel(event.target.value);
					}}
				>
					{plugin.settings.models.map((model) => (
						<option key={model} value={model}>
							{model}
						</option>
					))}
				</select>

				<button
					className={`chatterbox-tab${drawer === 'parameters' ? ' chatterbox-active' : ''}`}
					onClick={() => {
						toggle('parameters');
					}}
					aria-expanded={drawer === 'parameters'}
					title={`Generation settings — reasoning ${reasoningLabel(session).toLowerCase()}`}
				>
					{reasoningLabel(session)}
				</button>

				<button
					onClick={onHistory}
					aria-label="Chat history"
					title="Chat history"
				>
					<Icon name="history" fallback="⏱" />
				</button>

				<button
					onClick={session.newChat}
					disabled={
						session.messages.length === 0 &&
						context.paths.length === 0
					}
					aria-label="New chat"
					title="New chat"
				>
					<Icon name="file-plus" fallback="✎" />
				</button>
			</div>
		</div>
	);
}
