/**
 * The add-on bundler.
 *
 * osu!idle stores an add-on as one `source` string and loads it with
 * `import(URL.createObjectURL(new Blob([source])))`. A Blob module has no base
 * URL and no import map, so **nothing** resolves at load time: React, the
 * game's simulation, workers and CSS must all already be inside that one file,
 * and it must be an ES module exporting `mount` and `unmount`.
 *
 * That is what this produces.
 *
 * Output is **not minified by default**. Published add-ons are read by a human
 * moderator before they go live, and a single minified line is a poor thing to
 * ask anyone to review.
 */

import { build as esbuild, type BuildOptions } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
	assetQueryPlugin,
	cssTextPlugin,
	dedupePlugin,
	inlineWorkerPlugin,
	sharedSourcePlugin,
	stubModulePlugin,
	tsExtensionPlugin,
} from './plugins.js';

/**
 * The individual esbuild plugins, for a build that needs to assemble its own
 * pipeline rather than call {@link bundleAddon} - compiling a slice of an add-on
 * for a test, say, or bundling a worker on its own.
 */
export {
	assetQueryPlugin,
	cssTextPlugin,
	dedupePlugin,
	inlineWorkerPlugin,
	sharedSourcePlugin,
	stubModulePlugin,
	tsExtensionPlugin,
} from './plugins.js';

export type BundleOptions = {
	/** Entry module, exporting `mount` / `unmount` (usually via `defineAddon`). */
	entry: string;
	/** Where to write the single-file add-on source. */
	outfile: string;
	/** Root of an osu!idle checkout, to resolve `@osu-idle/shared` against. */
	gameRoot?: string;
	/** Banner metadata, so a reader can tell what the file is. */
	meta?: { name?: string; version?: string; gameVersion?: string; license?: string };
	minify?: boolean;
	sourcemap?: boolean;
	/**
	 * Modules to replace with throwing stubs, by path suffix - for trimming a
	 * heavy dependency the add-on never calls. See `stubModulePlugin`.
	 */
	stubModules?: Record<string, readonly string[]>;
	/**
	 * Packages that must resolve to a single copy even though the add-on's
	 * sources and the game's sources sit in different checkouts. See
	 * `dedupePlugin` - without this, shared libraries are bundled twice and
	 * prototype patches and `instanceof` stop working across the seam.
	 */
	dedupe?: readonly string[];
	/** Directory the deduped packages resolve from. Defaults to the entry's directory. */
	dedupeFrom?: string;
};

const sharedSrcOf = (gameRoot: string) => resolve(gameRoot, 'packages/shared/src');

/** esbuild settings shared by the add-on bundle and any inlined worker. */
const baseOptions = (
	gameRoot: string | undefined,
	minify: boolean,
	stubModules: Record<string, readonly string[]> = {},
	dedupe: readonly string[] = [],
	dedupeFrom = process.cwd(),
): BuildOptions => ({
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	// The add-on runs inside the shipped client, which is a production React build.
	define: { 'process.env.NODE_ENV': '"production"' },
	jsx: 'automatic',
	legalComments: 'inline',
	// A Blob-loaded module cannot fetch a sibling asset, so a WebAssembly
	// binary has to travel inside the bundle. Imported as base64, it is decoded
	// at runtime and handed to the module's init as a BufferSource. Costs about
	// a third more bytes than the binary itself.
	loader: { '.wasm': 'base64' },
	minify,
	plugins: [
		// Strip asset suffixes before anything tries to resolve them as modules.
		assetQueryPlugin(),
		// Dedupe first: it must see a bare package name before anything else
		// resolves it out of the game's checkout.
		dedupePlugin(dedupe, dedupeFrom),
		...(gameRoot ? [sharedSourcePlugin(sharedSrcOf(gameRoot))] : []),
		tsExtensionPlugin(),
		stubModulePlugin(stubModules),
		cssTextPlugin(),
	],
});

/** Build one worker entry to a self-contained string for inlining. */
const buildWorkerSource = async (
	entry: string,
	gameRoot: string | undefined,
	minify: boolean,
	stubModules: Record<string, readonly string[]>,
	dedupe: readonly string[],
	dedupeFrom: string,
): Promise<string> => {
	const result = await esbuild({
		...baseOptions(gameRoot, minify, stubModules, dedupe, dedupeFrom),
		entryPoints: [entry],
		write: false,
		// A worker built as ESM would need `type: 'module'` support *and* would
		// keep top-level await; IIFE keeps the inlined string self-contained.
		format: 'iife',
	});
	return result.outputFiles?.[0]?.text ?? '';
};

export type BundleResult = {
	outfile: string;
	/** Byte length of the emitted source - what the workshop stores. */
	bytes: number;
};

/** Bundle an add-on into the single ES module the runtime loads. */
export const bundleAddon = async (options: BundleOptions): Promise<BundleResult> => {
	const {
		entry, outfile, gameRoot, meta,
		minify = false, sourcemap = false, stubModules = {},
		dedupe = [], dedupeFrom = dirname(resolve(entry)),
	} = options;

	const base = baseOptions(gameRoot, minify, stubModules, dedupe, dedupeFrom);
	const result = await esbuild({
		...base,
		entryPoints: [entry],
		write: false,
		sourcemap: sourcemap ? 'inline' : false,
		plugins: [
			inlineWorkerPlugin(workerEntry =>
				buildWorkerSource(workerEntry, gameRoot, minify, stubModules, dedupe, dedupeFrom)),
			...(base.plugins ?? []),
		],
	});

	const code = result.outputFiles?.[0]?.text ?? '';
	// The trailing blank line is not optional: without it the last banner comment
	// would swallow the first line of generated code.
	const banner = meta
		? [
			'// ' + [meta.name, meta.version && `v${meta.version}`].filter(Boolean).join(' '),
			meta.gameVersion && `// built against osu!idle ${meta.gameVersion}`,
			meta.license && `// ${meta.license}`,
			'// Bundled with @osu-idle/addon-sdk. Paste this file into the add-on editor.',
		].filter(Boolean).join('\n') + '\n\n'
		: '';

	const source = banner + code;

	await mkdir(dirname(resolve(outfile)), { recursive: true });
	await writeFile(outfile, source, 'utf8');

	await assertAddonShape(outfile, source);

	return { outfile, bytes: Buffer.byteLength(source, 'utf8') };
};

/**
 * Fail the build if the output would not satisfy the runtime contract.
 *
 * A bundle missing `mount` loads without error and simply does nothing, which
 * is a miserable thing to debug from inside the game - much better to catch it
 * here.
 */
const assertAddonShape = async (outfile: string, source: string): Promise<void> => {
	const code = source || await readFile(outfile, 'utf8');
	if (!/export\s*\{[^}]*\bmount\b/.test(code) && !/export\s+(const|function)\s+mount\b/.test(code)) {
		throw new Error(
			`${outfile} does not export "mount" - the add-on runtime would load it and call nothing. ` +
			'Export it from your entry, e.g. `export const { mount, unmount } = defineAddon(...)`.',
		);
	}
};
