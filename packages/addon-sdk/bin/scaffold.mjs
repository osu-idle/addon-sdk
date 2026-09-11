/**
 * Scaffolding a new add-on.
 *
 * Shared by `osu-idle-addon init` and by `npm create osu-idle-addon`, so both
 * entry points produce exactly the same project.
 *
 * Templates are plain files with `__TOKEN__` placeholders rather than a
 * template language: they stay readable, and `templates/react/src/Addon.tsx` is
 * a working reference for someone reading the SDK itself.
 */
import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(here, '..', 'templates');

/** SDK version to depend on, taken from the SDK actually doing the scaffolding. */
const sdkVersion = async () => {
	try {
		const pkg = JSON.parse(await readFile(resolve(here, '..', 'package.json'), 'utf8'));
		return `^${pkg.version}`;
	} catch {
		return 'latest';
	}
};

/** `My Cool Add-on` -> `my-cool-add-on`. */
export const slugify = (name) =>
	name.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		|| 'my-addon';

/** `my-cool-addon` -> `MyCoolAddon`, a usable class name. */
export const classify = (slug) => {
	const name = slug.split('-')
		.filter(Boolean)
		.map(part => part[0].toUpperCase() + part.slice(1))
		.join('');
	// A class name cannot start with a digit.
	return /^[0-9]/.test(name) ? `Addon${name}` : (name || 'MyAddon');
};

const fill = (text, tokens) =>
	Object.entries(tokens).reduce(
		(out, [token, value]) => out.split(`__${token}__`).join(value),
		text,
	);

/** Copy a template directory, substituting tokens in every text file. */
const copyTemplate = async (from, to, tokens) => {
	for (const entry of await readdir(from, { withFileTypes: true })) {
		const source = join(from, entry.name);
		const target = join(to, entry.name);

		if (entry.isDirectory()) {
			await mkdir(target, { recursive: true });
			await copyTemplate(source, target, tokens);
			continue;
		}

		// Anything not text is copied verbatim; templates are all text today,
		// but this keeps a future binary asset from being corrupted.
		if (/\.(png|jpg|gif|wasm|woff2?)$/.test(entry.name)) {
			await cp(source, target);
			continue;
		}

		// npm strips `.gitignore` from published tarballs, so the template ships
		// it undotted and it is restored here - otherwise every scaffolded
		// project would arrive without one and commit its node_modules.
		const name = entry.name === 'gitignore' ? '.gitignore' : entry.name;
		const dest = join(dirname(target), name);

		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, fill(await readFile(source, 'utf8'), tokens), 'utf8');
	}
};

export const TEMPLATE_NAMES = ['react', 'plain'];

/**
 * Create an add-on project in `dir`.
 *
 * Refuses to write into a directory that already holds files, unless `force` -
 * scaffolding over someone's work is not recoverable.
 */
export const scaffold = async ({
	dir,
	name,
	template = 'react',
	license = 'AGPL-3.0-only',
	force = false,
}) => {
	if (!TEMPLATE_NAMES.includes(template)) {
		throw new Error(`Unknown template "${template}". Use one of: ${TEMPLATE_NAMES.join(', ')}`);
	}

	const target = resolve(dir);
	if (existsSync(target)) {
		const info = await stat(target);
		if (!info.isDirectory()) throw new Error(`${target} exists and is not a directory`);
		const existing = (await readdir(target)).filter(f => f !== '.git');
		if (existing.length && !force) {
			throw new Error(
				`${target} is not empty (${existing.length} entries). `
				+ 'Choose an empty directory, or pass --force.',
			);
		}
	}
	await mkdir(target, { recursive: true });

	const slug = slugify(name);
	const tokens = {
		ADDON_NAME: name,
		SLUG: slug,
		CLASS: classify(slug),
		LICENSE: license,
		OUTFILE: `dist/${slug}.js`,
		// A default hotkey letter that is unlikely to collide with the game's.
		KEY: (slug.match(/[a-z]/)?.[0] ?? 'k').toUpperCase(),
	};

	await copyTemplate(join(TEMPLATES, 'common'), target, tokens);
	await copyTemplate(join(TEMPLATES, template), target, tokens);

	const react = template === 'react';
	const pkg = {
		name: slug,
		version: '0.1.0',
		private: true,
		type: 'module',
		license,
		description: `${name} - an osu!idle add-on`,
		scripts: {
			build: 'osu-idle-addon build',
			dev: 'osu-idle-addon build --watch',
			typecheck: 'tsc -p tsconfig.json --noEmit',
		},
		dependencies: {
			'@osu-idle/addon-sdk': await sdkVersion(),
			...(react ? { react: '^18.3.1', 'react-dom': '^18.3.1' } : {}),
		},
		devDependencies: {
			...(react ? { '@types/react': '^18.3.12', '@types/react-dom': '^18.3.1' } : {}),
			typescript: '^5.6.3',
		},
	};
	await writeFile(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

	return { target, slug, template, outfile: tokens.OUTFILE };
};
