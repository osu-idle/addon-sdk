/**
 * React binding for a {@link SettingsStore}.
 *
 * Loads once on mount and writes back whenever a setting changes, so the values
 * a player picked are there the next time the overlay opens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsStore } from '../runtime/settings.js';

export type SettingsHandle<T extends object> = [
	settings: T,
	/** Merge a patch into the settings and persist. */
	update: (patch: Partial<T>) => void,
	/** Restore the defaults. */
	reset: () => void,
];

export const usePersistedSettings = <T extends object>(
	store: SettingsStore<T>,
	defaults: T,
): SettingsHandle<T> => {
	// Loaded in the initialiser so the first render already has the stored
	// values - a later effect would flash the defaults first.
	const [settings, setSettings] = useState<T>(() => store.load());

	const latest = useRef(settings);
	latest.current = settings;

	const update = useCallback((patch: Partial<T>) => {
		const next = { ...latest.current, ...patch };
		latest.current = next;
		setSettings(next);
		store.save(next);
	}, [store]);

	const reset = useCallback(() => {
		const next = { ...defaults };
		latest.current = next;
		setSettings(next);
		store.clear();
	}, [store, defaults]);

	// Persist whatever the component settled on when it goes away, covering a
	// value changed through some path other than `update`.
	useEffect(() => () => store.save(latest.current), [store]);

	return [settings, update, reset];
};
