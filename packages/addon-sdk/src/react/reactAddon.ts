/**
 * A React add-on.
 *
 * Bundles the two things a React overlay always needs - a shadow-rooted host
 * and a React 18 root - and ties both to the add-on lifecycle, so disabling the
 * add-on unmounts the tree and removes the host in one step.
 *
 * React itself is bundled into the add-on's single emitted file. Two add-ons
 * each carrying their own React is fine: they render into separate roots inside
 * separate shadow trees and never share a reconciler.
 */

import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Addon, type AddonMeta } from '../runtime/addon.js';
import { HotkeyManager } from '../runtime/input.js';
import { createOverlay, type Overlay } from './overlay.js';

export type ReactAddonMeta = AddonMeta & {
	/** Host element id. Defaults to a slug of the add-on name. */
	overlayId?: string;
	/** Stylesheet for the shadow tree. */
	styles?: string;
};

export abstract class ReactAddon extends Addon {

	private overlay?: Overlay;
	private root?: Root;

	/** Global shortcuts, bound ahead of the game's own handlers. */
	protected readonly hotkeys = new HotkeyManager();

	private readonly reactMeta: ReactAddonMeta;

	constructor(meta: ReactAddonMeta) {
		super(meta);
		this.reactMeta = meta;
	}

	/** The add-on's root component. Re-rendered only when {@link refresh} is called. */
	protected abstract render(): ReactNode;

	protected override async onMount(): Promise<void> {
		const id = this.reactMeta.overlayId
			?? `addon-${this.reactMeta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

		this.overlay = createOverlay({ id, styles: this.reactMeta.styles });
		this.root = createRoot(this.overlay.container);
		this.root.render(this.render());

		this.own(() => this.hotkeys.dispose());
		await this.onReady();
	}

	/** Hook for work that needs the overlay to exist (shortcuts, data loading). */
	protected onReady(): void | Promise<void> {}

	/** Re-render the tree - for state the add-on holds outside React. */
	protected refresh(): void {
		this.root?.render(this.render());
	}

	protected override async onUnmount(): Promise<void> {
		// React 18 warns if a root is unmounted while it is rendering, which is
		// possible here because the runtime can disable an add-on at any moment.
		const root = this.root;
		this.root = undefined;
		if (root) await Promise.resolve().then(() => root.unmount());
		this.overlay?.dispose();
		this.overlay = undefined;
	}
}
