/**
 * What the bundler stamped into this add-on.
 *
 * An add-on's version has to reach two places that must agree: the banner a
 * reviewer reads at the top of the file, and whatever the add-on shows the
 * player. Stating it in the source is how they drift - the literal sits at
 * whatever it last said while the build moves on - so the bundler defines it
 * here instead, from the single version it was told to build.
 *
 * Empty when the add-on was bundled by something other than `bundleAddon`,
 * which is why every field is optional.
 */

declare const __OSU_IDLE_ADDON__: BuildMeta | undefined;

export type BuildMeta = {
	name?: string;
	version?: string;
	/** The osu!idle release the bundle was built against. */
	gameVersion?: string;
	license?: string;
};

export const buildMeta = (): BuildMeta =>
	typeof __OSU_IDLE_ADDON__ === 'undefined' ? {} : __OSU_IDLE_ADDON__;
