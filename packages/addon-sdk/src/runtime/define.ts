import { Addon } from './addon.js';

/** The module shape osu!idle's add-on runtime imports and drives. */
export type AddonModule = {
	mount: () => void;
	unmount: () => void;
};

/**
 * Turn an {@link Addon} subclass into the `mount` / `unmount` pair the runtime
 * expects:
 *
 * ```ts
 * export const { mount, unmount } = defineAddon(() => new MyAddon());
 * ```
 *
 * The runtime calls both synchronously and ignores what they return, so an
 * async `onMount` is started and left to run - its failure is reported here
 * rather than surfacing as an unhandled rejection in the player's console.
 *
 * A mount still settling when `unmount` arrives (disable clicked mid-boot) is
 * awaited first, so teardown never races a half-built overlay.
 */
export const defineAddon = (create: () => Addon): AddonModule => {
	let instance: Addon | undefined;
	let settling: Promise<void> = Promise.resolve();

	return {
		mount: () => {
			instance = create();
			const addon = instance;
			settling = addon._mount().catch((e: unknown) => {
				console.error('[addon] mount failed', e);
			});
		},
		unmount: () => {
			const addon = instance;
			if (!addon) return;
			instance = undefined;
			settling = settling
				.then(() => addon._unmount())
				.catch((e: unknown) => console.error('[addon] unmount failed', e));
		},
	};
};
