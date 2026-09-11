/**
 * __ADDON_NAME__
 *
 * osu!idle loads an add-on by importing its built source as an ES module and
 * calling `mount` / `unmount`. That pair is the whole contract - `defineAddon`
 * produces it from the class in `Addon.tsx`.
 */

import { defineAddon } from '@osu-idle/addon-sdk';
import { __CLASS__ } from './Addon.js';

export const { mount, unmount } = defineAddon(() => new __CLASS__());
