/**
 * A scaffolded project must build into a real add-on.
 *
 * Scaffolds both templates into a temp directory, links the SDK, and runs the
 * generated `build` script - the point being that "npm create ... && npm run
 * build" works, not merely that files were written.
 */
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold, slugify, classify } from '../packages/addon-sdk/bin/scaffold.mjs';

/** This repo, so the generated projects are built against *this* SDK. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : (fail++, console.log('  FAIL:', n, x)); };

check('slugify strips punctuation', slugify('My Cool Add-on!') === 'my-cool-add-on');
check('slugify survives junk', slugify('!!!') === 'my-addon');
check('classify makes a class name', classify('my-cool-addon') === 'MyCoolAddon');
check('classify avoids a leading digit', classify('4k-helper') === 'Addon4kHelper');

const root = await mkdtemp(join(tmpdir(), 'sdk-scaffold-'));

for (const template of ['react', 'plain']) {
	const dir = join(root, template);
	const result = await scaffold({ dir, name: 'Test Add-on', template });

	check(`${template}: slug derived`, result.slug === 'test-add-on', result.slug);
	check(`${template}: package.json written`, existsSync(join(dir, 'package.json')));
	check(`${template}: addon.config.json written`, existsSync(join(dir, 'addon.config.json')));
	check(`${template}: entry written`, existsSync(join(dir, 'src/index.ts')));
	// npm strips .gitignore from tarballs; the template ships it undotted.
	check(`${template}: .gitignore restored`, existsSync(join(dir, '.gitignore')));
	check(`${template}: no undotted gitignore left`, !existsSync(join(dir, 'gitignore')));

	const config = JSON.parse(await readFile(join(dir, 'addon.config.json'), 'utf8'));
	check(`${template}: config carries the display name`, config.name === 'Test Add-on', config.name);
	check(`${template}: outfile matches the slug`, config.outfile === 'dist/test-add-on.js', config.outfile);

	// No placeholder may survive into a generated project.
	for (const file of await readdir(join(dir, 'src'))) {
		const text = await readFile(join(dir, 'src', file), 'utf8');
		check(`${template}: no unreplaced tokens in ${file}`, !/__[A-Z_]+__/.test(text),
			text.match(/__[A-Z_]+__/)?.[0] ?? '');
	}

	// Point the generated project at this working copy of the SDK, install, build.
	const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
	pkg.dependencies['@osu-idle/addon-sdk'] = `file:${REPO}/packages/addon-sdk`;
	await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

	try {
		execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund'],
			{ cwd: dir, stdio: 'pipe' });
		execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'pipe' });
	} catch (e) {
		check(`${template}: scaffolded project builds`, false,
			String(e.stderr ?? e.stdout ?? e).slice(-400));
		continue;
	}

	const built = join(dir, 'dist/test-add-on.js');
	check(`${template}: emitted the bundle`, existsSync(built));
	const code = await readFile(built, 'utf8');
	check(`${template}: exports mount`, /\bmount\b/.test(code));
	check(`${template}: exports unmount`, /\bunmount\b/.test(code));
	check(`${template}: carries the display name`, code.includes('Test Add-on'));

	// Banner and runtime both report the package.json version.
	const pkgVersion = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version;
	check(`${template}: banner carries the package version`,
		code.startsWith(`// Test Add-on v${pkgVersion}\n`), code.slice(0, 40));
	check(`${template}: version is stamped into the runtime`,
		new RegExp(`version:\\s*"${pkgVersion}"`).test(code)
		|| code.includes(`"version":"${pkgVersion}"`), 'not found in bundle');
	check(`${template}: no version literal in source`,
		!(await readFile(join(dir, 'addon.config.json'), 'utf8')).includes('version'));
	if (template === 'react') {
		check('react: React is bundled in', code.length > 100_000, `${code.length} bytes`);
	}
}

// Refuses to overwrite someone's work unless told to.
const occupied = join(root, 'occupied');
await scaffold({ dir: occupied, name: 'First', template: 'plain' });
let refused = false;
try { await scaffold({ dir: occupied, name: 'Second', template: 'plain' }); }
catch { refused = true; }
check('refuses a non-empty directory', refused);
await scaffold({ dir: occupied, name: 'Second', template: 'plain', force: true });
check('--force overrides that',
	JSON.parse(await readFile(join(occupied, 'addon.config.json'), 'utf8')).name === 'Second');

let rejected = false;
try { await scaffold({ dir: join(root, 'x'), name: 'X', template: 'nope' }); }
catch { rejected = true; }
check('rejects an unknown template', rejected);

await rm(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
