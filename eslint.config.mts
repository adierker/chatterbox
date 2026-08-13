import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'main.js',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// "OpenRouter" is a proper noun. The rule has no way to know that and
		// wants it written "Openrouter".
		rules: { 'obsidianmd/ui/sentence-case': 'off' },
	},
	{
		// SPEC §3: requestUrl bypasses CORS but buffers the whole response, so
		// streaming completions have to go through fetch.
		files: ['src/openrouter.ts'],
		rules: { 'no-restricted-globals': 'off' },
	},
	{
		// SPEC §4.3 asks for secretStorage where the installed Obsidian has it
		// (1.11.4+) and data.json otherwise, so minAppVersion deliberately sits
		// below it and the calls are guarded at runtime instead.
		files: ['src/settings.ts'],
		rules: { 'obsidianmd/no-unsupported-api': 'off' },
	},
	{
		// Tests run under Node and never ship inside the plugin bundle.
		// node:test's describe/it return promises that are not meant to be awaited.
		files: ['src/**/*.test.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
);
