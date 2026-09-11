#!/usr/bin/env node
/**
 * npx @osu-idle/addon-sdk-create@latest my-addon
 *
 * A thin front door. The scaffolding itself lives in the SDK, so `npm create`
 * and `osu-idle-addon init` cannot drift apart - this only parses arguments and
 * prints what happened.
 */
import { scaffold, TEMPLATE_NAMES } from '@osu-idle/addon-sdk/scaffold';
import { relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const positional = () => {
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith('--')) { i++; continue; }
		return args[i];
	}
	return undefined;
};

if (flag('help') || flag('h')) {
	console.log(`Create an osu!idle add-on.

  npx @osu-idle/addon-sdk-create@latest [dir]
    --name "My Add-on"      display name (default: the directory name)
    --template ${TEMPLATE_NAMES.join('|')}     starting point (default: react)
    --license <spdx>        default: AGPL-3.0-only
    --force                 write into a non-empty directory
`);
	process.exit(0);
}

const dir = positional() ?? '.';
const name = option('name', resolve(dir).split(/[\\/]/).pop());

try {
	const result = await scaffold({
		dir,
		name,
		template: option('template', 'react'),
		license: option('license', 'AGPL-3.0-only'),
		force: flag('force'),
	});

	const where = relative(process.cwd(), result.target) || '.';
	console.log(`\nCreated ${name} in ${where}/  (${result.template} template)\n`);
	console.log('Next:');
	if (where !== '.') console.log(`  cd ${where}`);
	console.log('  npm install');
	console.log('  npm run build\n');
	console.log(`Then paste ${result.outfile} into the in-game add-on editor.\n`);
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
