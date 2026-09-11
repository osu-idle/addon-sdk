/**
 * The overlay host.
 *
 * An add-on shares one document with the whole game, so a naive `<div>` on
 * `document.body` inherits the client's styles and leaks its own back. The host
 * therefore attaches a **shadow root** and renders inside it: the game's CSS
 * stops at the boundary, and the add-on's stylesheet cannot restyle the game.
 *
 * Input is isolated at the host element, where events from inside the shadow
 * tree bubble through - see `runtime/input.ts` for why bubble phase is the
 * right place for that.
 */

import type { Disposer } from '../runtime/addon.js';
import { isolateInput } from '../runtime/input.js';

/**
 * Default stacking order: above every piece of game UI, below the cursor.
 *
 * The client draws its own osu! cursor as a DOM element (`.cursor`, z-index
 * 100000, with `.cursor-trail` at 99999) and hides the system one with
 * `html.custom-cursor * { cursor: none !important }`. An overlay stacked above
 * that layer breaks the pointer twice over: it covers the drawn cursor, and -
 * because `cursor` is an inherited property - the `cursor: none` on the host
 * inherits through the shadow boundary, so the system cursor stays hidden too.
 * The player is left with no pointer at all, flickering into view only over
 * translucent parts of the overlay.
 *
 * Sitting below the cursor layer instead means the osu! cursor draws over the
 * overlay exactly as it does over the rest of the game. The game's own UI tops
 * out around 20000, so this clears it comfortably.
 */
export const OVERLAY_Z_INDEX = 50_000;

export type OverlayOptions = {
	/** Element id, so a stale host from a failed unmount can be reclaimed. */
	id: string;
	/** CSS for the shadow tree. The bundler inlines `.css` imports into a string. */
	styles?: string;
	/**
	 * Stacking order against the game's own layers. Defaults to
	 * {@link OVERLAY_Z_INDEX}; raising it above 99999 will hide the player's
	 * cursor.
	 */
	zIndex?: number;
};

export type Overlay = {
	/** The element in the page. Input isolation is bound here. */
	host: HTMLElement;
	/** The shadow root React renders into. */
	container: HTMLElement;
	dispose: Disposer;
};

/**
 * Create the overlay host. Idempotent by `id`: a host left behind by a crashed
 * unmount is removed rather than duplicated, so enable/disable cycles cannot
 * stack overlays.
 */
export const createOverlay = ({ id, styles, zIndex = OVERLAY_Z_INDEX }: OverlayOptions): Overlay => {
	document.getElementById(id)?.remove();

	const host = document.createElement('div');
	host.id = id;
	// `pointer-events: none` keeps the (full-screen) host from swallowing clicks
	// meant for the game; the rendered panels turn it back on for themselves.
	host.style.cssText =
		`position:fixed;inset:0;z-index:${zIndex};pointer-events:none;`;

	const shadow = host.attachShadow({ mode: 'open' });

	if (styles) {
		const sheet = document.createElement('style');
		sheet.textContent = styles;
		shadow.append(sheet);
	}

	const container = document.createElement('div');
	container.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
	shadow.append(container);

	document.body.append(host);

	const releaseInput = isolateInput(host);

	return {
		host,
		container,
		dispose: () => {
			releaseInput();
			host.remove();
		},
	};
};
