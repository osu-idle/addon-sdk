/**
 * __ADDON_NAME__
 *
 * osu!idle loads an add-on by importing its built source as an ES module and
 * calling `mount` / `unmount`. That pair is the whole contract - `defineAddon`
 * produces it from the class below.
 */

import { Addon, defineAddon, gameDb } from '@osu-idle/addon-sdk';

class __CLASS__ extends Addon {

	constructor() {
		super({ name: '__ADDON_NAME__' });
	}

	protected async onMount(): Promise<void> {
		// The client opens its database lazily, so wait before querying it.
		await gameDb.ready();

		const played = await gameDb.value<number>('SELECT COUNT(*) FROM score');
		this.log.info(`hello! you have ${played ?? 0} scores stored locally`);

		// Anything registered through `this.on` / `this.interval` / `this.own`
		// is torn down automatically when the add-on is disabled or updated.
		this.on(window, 'keydown', event => {
			if (event.key === 'F9') this.log.info('F9');
		});
	}
}

export const { mount, unmount } = defineAddon(() => new __CLASS__());
