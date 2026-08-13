import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', ...builtinModules],
	// React picks its build off this at require time. Without it esbuild bundles
	// both builds and leaves a bare `process.env` lookup in the output.
	define: {
		'process.env.NODE_ENV': prod ? '"production"' : '"development"',
	},
	format: 'cjs',
	target: 'es2021',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
