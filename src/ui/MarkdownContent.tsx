import { useEffect, useRef } from 'react';
import { MarkdownRenderer } from 'obsidian';
import { useObsidian } from './ObsidianContext';

/**
 * Renders markdown through Obsidian so code blocks, callouts and internal
 * links behave the same as they do in a note.
 */
export function MarkdownContent({ markdown }: { markdown: string }) {
	const { app, component } = useObsidian();
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		container.empty();
		void MarkdownRenderer.render(app, markdown, container, '', component);
	}, [markdown, app, component]);

	return <div className="chatterbox-markdown" ref={containerRef} />;
}
