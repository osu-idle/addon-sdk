/**
 * Persisted add-on settings.
 *
 * An add-on is remounted on every boot and on every enable/disable, so anything
 * held only in component state is re-entered by the player each time. Settings
 * belong in `localStorage`, which is the same store the client keeps its own
 * options in and survives reloads without touching the game's database.
 *
 * **Keys are namespaced deliberately.** The client writes its settings under
 * bare, unprefixed keys (`db/settings.ts`), and reads them back with a bare
 * `JSON.parse`. An add-on writing a colliding key would corrupt a game setting,
 * so everything here lives under `osu-idle-addon:<namespace>`.
 *
 * Stored values are merged **over** the defaults on load, so adding a setting in
 * a later version does not invalidate what a player already saved, and only keys
 * the defaults still declare are kept - a removed setting cleans itself up.
 */

const PREFIX = 'osu-idle-addon:';

export type SettingsStore<T extends object> = {
	/** The full storage key, for debugging. */
	readonly key: string;
	/** Stored settings merged over the defaults. Never throws. */
	load(): T;
	/** Persist the whole settings object. Never throws. */
	save(value: T): void;
	/** Forget the stored settings. */
	clear(): void;
};

/**
 * A namespaced settings store.
 *
 * Every operation is guarded: `localStorage` can be unavailable (private
 * browsing, storage disabled) or full, and losing settings must never take the
 * add-on - or the game - down with it.
 */
export const createSettings = <T extends object>(
	namespace: string,
	defaults: T,
): SettingsStore<T> => {
	const key = `${PREFIX}${namespace}`;

	return {
		key,

		load(): T {
			try {
				const raw = localStorage.getItem(key);
				if (!raw) return { ...defaults };

				const stored = JSON.parse(raw) as Partial<T>;
				if (!stored || typeof stored !== 'object') return { ...defaults };

				// Take only keys the defaults still declare, and only when the
				// stored value has the same shape - a hand-edited or stale entry
				// must not put a string where a number is expected.
				const merged = { ...defaults };
				for (const name of Object.keys(defaults) as (keyof T)[]) {
					const value = stored[name];
					if (value === undefined) continue;
					if (typeof value !== typeof defaults[name]) continue;
					merged[name] = value as T[keyof T];
				}
				return merged;
			} catch {
				return { ...defaults };
			}
		},

		save(value: T): void {
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch {
				// Full or unavailable storage: the add-on still works, it just
				// will not remember. Not worth interrupting the player over.
			}
		},

		clear(): void {
			try {
				localStorage.removeItem(key);
			} catch { /* nothing to do */ }
		},
	};
};
