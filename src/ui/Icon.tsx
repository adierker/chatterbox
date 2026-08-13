import { useEffect, useRef } from 'react';
import { setIcon } from 'obsidian';

/**
 * An Obsidian (lucide) icon. Falls back to a text glyph if the icon name is
 * not in the installed set, so a button is never rendered empty.
 */
export function Icon({ name, fallback }: { name: string; fallback: string }) {
	const ref = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		element.empty();
		setIcon(element, name);
		if (element.childElementCount === 0) element.setText(fallback);
	}, [name, fallback]);

	return <span className="chatterbox-icon" ref={ref} />;
}
