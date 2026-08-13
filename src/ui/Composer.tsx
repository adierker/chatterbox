import { ChangeEvent, KeyboardEvent, useRef, useState } from 'react';
import { Platform } from 'obsidian';

interface ComposerProps {
	onSend: (text: string) => void;
	/** Opens the file picker; triggered by typing @. */
	onMention: () => void;
	/** Fired when the composer takes focus, so open drawers can collapse. */
	onFocus: () => void;
	/** Aborts the reply currently streaming. */
	onStop: () => void;
	/** True while a reply is streaming. */
	streaming: boolean;
	/** Which keystroke sends (SPEC §6). */
	sendShortcut: 'enter' | 'mod-enter';
	disabled: boolean;
}

export function Composer({
	onSend,
	onMention,
	onFocus,
	onStop,
	streaming,
	sendShortcut,
	disabled,
}: ComposerProps) {
	const [text, setText] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const canSend = !disabled && text.trim() !== '';

	const submit = () => {
		if (disabled || text.trim() === '') return;
		onSend(text);
		setText('');
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== 'Enter') return;

		const withModifier = event.metaKey || event.ctrlKey;
		const sends =
			sendShortcut === 'mod-enter'
				? withModifier
				: !withModifier && !event.shiftKey;

		if (sends) {
			event.preventDefault();
			submit();
		}
	};

	const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
		const value = event.target.value;
		const cursor = event.target.selectionStart;

		// A freshly typed @ at a word boundary opens the picker instead of
		// being inserted, mirroring the mention affordance in SPEC §4.2.
		const typedOneChar = value.length === text.length + 1;
		if (typedOneChar && value[cursor - 1] === '@') {
			const preceding = cursor >= 2 ? value[cursor - 2] : undefined;
			if (preceding === undefined || /\s/.test(preceding)) {
				setText(value.slice(0, cursor - 1) + value.slice(cursor));
				onMention();
				return;
			}
		}

		setText(value);
	};

	return (
		<div className="chatterbox-composer">
			<textarea
				ref={textareaRef}
				className="chatterbox-input"
				// A tall composer is comfortable on desktop and swallows the
				// conversation on a phone, where the panel is far shorter.
				rows={Platform.isMobile ? 3 : 9}
				value={text}
				placeholder={
					disabled
						? 'Waiting for a response…'
						: 'Message — @ to attach a note'
				}
				aria-label="Message"
				onChange={onChange}
				onKeyDown={onKeyDown}
				onFocus={onFocus}
			/>
			{streaming ? (
				<button className="chatterbox-send" onClick={onStop}>
					Stop
				</button>
			) : (
				<button
					className={`chatterbox-send${canSend ? ' mod-cta' : ''}`}
					disabled={!canSend}
					onClick={submit}
				>
					Send
				</button>
			)}
		</div>
	);
}
