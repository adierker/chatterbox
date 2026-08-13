import { createContext, useContext } from 'react';
import type { App, Component } from 'obsidian';

export interface ObsidianContextValue {
	app: App;
	/** Lifecycle owner for anything MarkdownRenderer creates. */
	component: Component;
}

const ObsidianContext = createContext<ObsidianContextValue | null>(null);

export const ObsidianProvider = ObsidianContext.Provider;

export function useObsidian(): ObsidianContextValue {
	const value = useContext(ObsidianContext);
	if (!value) {
		throw new Error('useObsidian called outside of ObsidianProvider');
	}
	return value;
}
