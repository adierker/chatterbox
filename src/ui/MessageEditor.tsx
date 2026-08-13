import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import type ChatterboxPlugin from '../main';
import { ChatMessage, ChatParameters } from '../types';
import { ParameterControls } from './ParameterControls';
import { withDefaults } from '../parameters';

interface MessageEditorProps {
	plugin: ChatterboxPlugin;
	message: ChatMessage;
	model: string;
	parameters: ChatParameters;
	onSubmit: (
		content: string,
		model: string,
		parameters: ChatParameters,
	) => void;
	onCancel: () => void;
}

/**
 * Editing a message in place (SPEC §4.4). For a user's own message, the model and
 * every parameter can change in the same action as the text — going back to
 * edit a prompt is often about wanting a different model or temperature, not
 * different wording, and it should take one send, not two.
 */
export function MessageEditor({
	plugin,
	message,
	model,
	parameters,
	onSubmit,
	onCancel,
}: MessageEditorProps) {
	const [text, setText] = useState(message.content);
	const [draftModel, setDraftModel] = useState(model);
	const [draftParameters, setDraftParameters] = useState(parameters);
	const [showSettings, setShowSettings] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const isReply = message.role === 'assistant';

	// Sized to the content, per SPEC §4.4. Runs on mount and on every change,
	// since the box has to keep pace with what is typed into it.
	const fitToContent = (textarea: HTMLTextAreaElement) => {
		textarea.setCssProps({ '--chatterbox-editor-height': 'auto' });
		textarea.setCssProps({
			'--chatterbox-editor-height': `${String(textarea.scrollHeight)}px`,
		});
	};

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;

		fitToContent(textarea);
		textarea.focus();
		const end = textarea.value.length;
		textarea.setSelectionRange(end, end);
	}, []);

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			onCancel();
		}
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			onSubmit(text, draftModel, draftParameters);
		}
	};

	return (
		<div className="chatterbox-editor">
			<textarea
				ref={textareaRef}
				className="chatterbox-editor-text"
				value={text}
				onChange={(event) => {
					setText(event.target.value);
					fitToContent(event.target);
				}}
				onKeyDown={onKeyDown}
			/>

			{!isReply && showSettings && (
				<div className="chatterbox-editor-settings">
					<select
						className="dropdown"
						value={draftModel}
						onChange={(event) => {
							setDraftModel(event.target.value);
						}}
					>
						{plugin.settings.models.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
					<ParameterControls
						parameters={draftParameters}
						model={draftModel}
						effortOptions={plugin.settings.effortOptions}
						onChange={setDraftParameters}
						onRestoreDefaults={() => {
							setDraftParameters(
								withDefaults(plugin.settings.defaultParameters),
							);
						}}
						onClear={() => {
							setDraftParameters({});
						}}
					/>
				</div>
			)}

			<div className="chatterbox-editor-actions">
				{!isReply && (
					<button
						onClick={() => {
							setShowSettings((open) => !open);
						}}
					>
						{showSettings ? 'Hide settings' : 'Model & settings'}
					</button>
				)}
				<span className="chatterbox-editor-spacer" />
				<button onClick={onCancel}>Cancel</button>
				<button
					className="mod-cta"
					onClick={() => {
						onSubmit(text, draftModel, draftParameters);
					}}
				>
					{isReply ? 'Save' : 'Send'}
				</button>
			</div>

			<div className="chatterbox-hint">
				{isReply
					? 'Saving keeps your text, drops anything after it, and forks — the original reply stays on disk.'
					: 'Sending drops everything after this message and forks; the original conversation stays on disk.'}
			</div>
		</div>
	);
}
