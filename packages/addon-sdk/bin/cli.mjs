#!/usr/bin/env node
/**
 * osu-idle-addon - the osu!idle Addon SDK command line.
 *
 *   osu-idle-addon init [dir] [--name "My Add-on"] [--template react|plain]
 *   osu-idle-addon build [--config addon.config.json] [--minify] [--watch]
 */
import { readFile } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { resolve, relative } from 'node:path';
import { scaffold, TEMPLATE_NAMES } from './scaffold.mjs';

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'build';
const args = argv.slice(argv[0] === command ? 1 : 0);

const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
/** First argument that is not a flag or a flag's value. */
const positional = () => {
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith('--')) { i++; continue; }
		return args[i];
	}
	return undefined;
};

const usage = `osu!idle Addon SDK

  osu-idle-addon init [dir]        create a new add-on project
    --name "My Add-on"             display name (default: the directory name)
    --template ${TEMPLATE_NAMES.join('|').padEnd(20)}starting point (default: react)
    --license <spdx>               default: AGPL-3.0-only
    --force                        write into a non-empty directory

  osu-idle-addon build             bundle the add-on into one ES module
    --config <path>                default: addon.config.json
    --minify                       smaller, but harder for a reviewer to read
    --sourcemap                    inline source map
    --watch                        rebuild on change
`;

const die = (message) => { console.error(message); process.exit(1); };

if (flag('help') || flag('h') || command === 'help') {
	console.log(usage);
	process.exit(0);
}

if (command === 'init') {
	const dir = positional() ?? '.';
	const name = option('name', resolve(dir).split(/[\\/]/).pop());

	const result = await scaffold({
		dir,
		name,
		template: option('template', 'react'),
		license: option('license', 'AGPL-3.0-only'),
		force: flag('force'),
	}).catch(e => die(e.message));

	const where = relative(process.cwd(), result.target) || '.';
	console.log(`Created ${name} in ${where}/  (${result.template} template)\n`);
	console.log('Next:');
	if (where !== '.') console.log(`  cd ${where}`);
	console.log('  npm install');
	console.log('  npm run build\n');
	console.log(`Then paste ${result.outfile} into the in-game add-on editor.`);
	process.exit(0);
}

if (command !== 'build') die(`Unknown command "${command}".\n\n${usage}`);

// ---- build ---------------------------------------------------------------

const { bundleAddon } = await import('../dist/build/index.js');

const configPath = resolve(option('config', 'addon.config.json'));
if (!existsSync(configPath)) {
	die(`No config at ${configPath}.\nRun "osu-idle-addon init" to create a project, or pass --config.`);
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const cwd = resolve(configPath, '..');

if (!config.entry || !config.outfile) {
	die(`${configPath} needs both "entry" and "outfile".`);
}

/**
 * The add-on's version, from package.json - the one file that must carry one.
 * Repeating it in addon.config.json is how a bundle ends up claiming a version
 * it is not.
 */
const pkgVersion = await readFile(resolve(cwd, 'package.json'), 'utf8')
	.then(raw => JSON.parse(raw).version)
	.catch(() => undefined);

const run = async () => {
	const started = Date.now();
	const { outfile, bytes } = await bundleAddon({
		entry: resolve(cwd, config.entry),
		outfile: resolve(cwd, config.outfile),
		gameRoot: process.env.OSU_IDLE_PATH ?? config.gameRoot,
		minify: flag('minify') || !!config.minify,
		sourcemap: flag('sourcemap'),
		stubModules: config.stubModules,
		dedupe: config.dedupe,
		dedupeFrom: cwd,
		meta: {
			name: config.name,
			version: pkgVersion,
			gameVersion: process.env.OSU_IDLE_GAME_VERSION ?? config.gameVersion,
			license: config.license,
		},
	});
	console.log(
		`built ${relative(process.cwd(), outfile)} - ${(bytes / 1024).toFixed(1)} kB`
		+ ` in ${Date.now() - started}ms`,
	);
};

await run().catch(e => die(e.message ?? e));

if (flag('watch')) {
	const src = resolve(cwd, 'src');
	console.log(`watching ${relative(process.cwd(), src)}/ ...`);
	let queued;
	watch(src, { recursive: true }, () => {
		clearTimeout(queued);
		queued = setTimeout(() => run().catch(e => console.error(e.message ?? e)), 120);
	});
}
