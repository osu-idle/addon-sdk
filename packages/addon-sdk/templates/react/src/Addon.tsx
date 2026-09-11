/**
 * __ADDON_NAME__
 *
 * The panel is mounted for the add-on's whole life and only *hidden* when
 * closed. Returning `null` instead would unmount the React tree, discarding its
 * state and running cleanup - so anything the overlay had started would be
 * thrown away the moment the player closed it.
 */

import type { ReactNode } from 'react';
import { ReactAddon } from '@osu-idle/addon-sdk/react';
import Panel from './Panel.js';
import styles from './styles.css';

const TOGGLE = 'Ctrl+Shift+__KEY__';
const VERSION = '0.1.0';

export class __CLASS__ extends ReactAddon {

	private open = false;

	constructor() {
		super({ name: '__ADDON_NAME__', version: VERSION, overlayId: '__SLUG__', styles });
	}

	protected override async onReady(): Promise<void> {
		// Registered in the capture phase, ahead of the game's own handlers, so
		// the combo never reaches gameplay.
		this.own(this.hotkeys.register(TOGGLE, () => this.toggle(), { allowInText: true }));
		this.own(this.hotkeys.register('Escape', () => {
			if (this.open) this.toggle();
		}, { allowInText: true }));

		this.log.info(`ready - press ${TOGGLE} to open`);
	}

	private toggle(): void {
		this.open = !this.open;
		this.refresh();
	}

	protected render(): ReactNode {
		return <Panel open={this.open} version={VERSION} onClose={() => this.toggle()} />;
	}
}
