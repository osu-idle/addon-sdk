import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'esbuild';

/**
 * Resolve `@osu-idle/shared/*` against a checkout of the game.
 *
 * The package is `private: true` and never published, so there is nothing to
 * install - the add-on compiles the game's TypeScript sources into its own
 * bundle instead. Its `exports` map points at `dist/`, which a plain checkout
 * has not built, so this resolves to `src/` directly.
 *
 * The sources are written for NodeNext, where a relative import of a TypeScript
 * file spells its *output* extension (`'../skills.js'` for `skills.ts`). esbuild
 * takes that literally and would fail to find the file, so both this plugin and
 * {@link tsExtensionPlugin} map `.js` back onto the `.ts` that produced it.
 */
export const sharedSourcePlugin = (sharedSrc: string): Plugin => ({
	name: 'osu-idle-shared-source',
	setup(build) {
		build.onResolve({ filter: /^@osu-idle\/shared(\/.*)?$/ }, args => {
			const subpath = args.path.replace(/^@osu-idle\/shared\/?/, '') || 'index';
			const base = resolve(sharedSrc, subpath.replace(/\.js$/, ''));
			for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
				if (existsSync(candidate)) return { path: candidate };
			}
			return {
				errors: [{
					text: `Cannot resolve "${args.path}" in the osu!idle checkout (looked under ${sharedSrc})`,
				}],
			};
		});
	},
});

/**
 * Map a relative `./x.js` import onto the `./x.ts` beside it.
 *
 * Only applies when the `.js` file does not exist and a `.ts` does, so a
 * genuine JavaScript dependency is never hijacked.
 */
export const tsExtensionPlugin = (): Plugin => ({
	name: 'ts-extension',
	setup(build) {
		build.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, args => {
			if (!args.importer.match(/\.tsx?$/)) return undefined;
			const js = resolve(dirname(args.importer), args.path);
			if (existsSync(js)) return undefined;
			for (const candidate of [js.replace(/\.js$/, '.ts'), js.replace(/\.js$/, '.tsx')]) {
				if (existsSync(candidate)) return { path: candidate };
			}
			return undefined;
		});
	},
});

/**
 * `import worker from 'worker:./sim.worker'` - build that entry as its own
 * bundle and inline it as a source string, plus a factory that spawns it from a
 * Blob URL.
 *
 * An add-on is itself loaded from a Blob, so it has no URL to resolve a worker
 * file against; the worker has to travel inside the same file. Workers matter
 * here because the game is a rhythm game sharing this thread - a simulation
 * sweep run on the main thread would stutter gameplay.
 */
export const inlineWorkerPlugin = (buildWorker: (entry: string) => Promise<string>): Plugin => ({
	name: 'inline-worker',
	setup(build) {
		build.onResolve({ filter: /^worker:/ }, args => {
			const target = args.path.slice('worker:'.length);
			const base = resolve(dirname(args.importer), target);
			for (const candidate of [base, `${base}.ts`, `${base}.js`]) {
				if (existsSync(candidate)) return { path: candidate, namespace: 'inline-worker' };
			}
			return { errors: [{ text: `Worker entry not found: ${args.path}` }] };
		});

		build.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async args => ({
			contents: `
const source = ${JSON.stringify(await buildWorker(args.path))};
let url;
/** Spawn the inlined worker. The Blob URL is created once and reused. */
export default function createWorker() {
	url ??= URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	return new Worker(url, { type: 'module' });
}
`,
			loader: 'js',
			resolveDir: dirname(args.path),
		}));
	},
});

/** Load `.css` imports as strings, for injection into the overlay's shadow root. */
export const cssTextPlugin = (): Plugin => ({
	name: 'css-text',
	setup(build) {
		build.onLoad({ filter: /\.css$/ }, async args => ({
			contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))};`,
			loader: 'js',
		}));
	},
});

/**
 * Replace a module the add-on never actually calls.
 *
 * The game's modules are written for an app that ships everything, so a small
 * helper can sit in a file that also pulls in something large - importing
 * `hasUnlock` from `shared/rebirth` drags in the whole of zod, half a megabyte,
 * for three lines of logic that never touch it. esbuild cannot drop that on its
 * own: building a zod schema at module scope is a side effect, so the import is
 * kept even though nothing uses its exports.
 *
 * Stubbing lets the add-on keep importing the game's real helper - so the logic
 * stays the game's, not a copy - while the unused dependency is left out.
 *
 * The stub **throws** if anything ever reaches it, so a wrong guess about what
 * is unused fails loudly at the call instead of silently misbehaving.
 *
 * `stubs` maps a path suffix (e.g. `shared/src/onboarding.ts`) to the names to
 * export from the replacement.
 */
export const stubModulePlugin = (stubs: Record<string, readonly string[]>): Plugin => ({
	name: 'stub-module',
	setup(build) {
		const suffixes = Object.keys(stubs);
		if (!suffixes.length) return;

		build.onLoad({ filter: /\.tsx?$/ }, args => {
			const normalized = args.path.split('\\').join('/');
			const match = suffixes.find(suffix => normalized.endsWith(suffix));
			if (!match) return undefined;

			const names = stubs[match] ?? [];
			const contents = names.map(name =>
				`export const ${name} = new Proxy(function () {}, {\n` +
				`	get() { throw new Error('${name} was stubbed out of this add-on bundle but is being used'); },\n` +
				`	apply() { throw new Error('${name} was stubbed out of this add-on bundle but is being called'); },\n` +
				'});',
			).join('\n');

			return { contents, loader: 'js' };
		});
	},
});

/**
 * Force a package to resolve to one copy.
 *
 * An add-on bundles its own sources *and* the game's, which live in a different
 * checkout with its own `node_modules`. esbuild resolves each import from the
 * importing file, so a package both sides use - `osu-classes`, say - gets
 * bundled **twice**: the game's sim ends up holding different class objects from
 * the ones the add-on's decoder produces.
 *
 * That is not just wasted bytes. Prototype patches apply to one copy while the
 * other is the one actually used (the game's control-point decode patch fails
 * exactly this way), and `instanceof` across the boundary silently returns
 * false.
 *
 * Resolving these names from a single directory collapses them to one copy.
 * The versions must be compatible, which is why the add-on pins the same ones
 * the game does.
 */
export const dedupePlugin = (names: readonly string[], fromDir: string): Plugin => ({
	name: 'dedupe',
	setup(build) {
		if (!names.length) return;
		const pattern = new RegExp(`^(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(\\/.*)?$`);

		build.onResolve({ filter: pattern }, async args => {
			// Skip our own re-resolution, or we recurse forever.
			if (args.pluginData === 'dedupe') return undefined;

			const result = await build.resolve(args.path, {
				kind: args.kind,
				resolveDir: fromDir,
				pluginData: 'dedupe',
			});
			if (result.errors.length) return undefined;
			return { path: result.path, external: result.external };
		});
	},
});

/**
 * Explicit asset imports: `import bytes from './thing.wasm?base64'`.
 *
 * The suffix does two jobs. It says at the import site how the file arrives -
 * mirroring the `?url` convention the client uses under Vite - and it keeps
 * TypeScript off a shipped `.wasm.d.ts`, which would otherwise win over the
 * add-on's own `declare module` and report the import as having no default
 * export.
 *
 * Resolution strips the suffix, so esbuild's loader for the real extension
 * (`.wasm` -> base64) applies as normal.
 */
export const assetQueryPlugin = (): Plugin => ({
	name: 'asset-query',
	setup(build) {
		build.onResolve({ filter: /\?(base64|text)$/ }, async args => {
			if (args.pluginData === 'asset-query') return undefined;
			const path = args.path.replace(/\?(base64|text)$/, '');
			const result = await build.resolve(path, {
				kind: args.kind,
				resolveDir: args.resolveDir,
				importer: args.importer,
				pluginData: 'asset-query',
			});
			if (result.errors.length) return { errors: result.errors };
			return { path: result.path, external: result.external };
		});
	},
});
