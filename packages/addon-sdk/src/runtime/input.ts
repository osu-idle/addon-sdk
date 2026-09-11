/**
 * Keeping an overlay's input out of the game.
 *
 * The client binds its gameplay controls as **bubble-phase listeners on
 * `window`** (`input/Controls.ts`), and the same is true of the scene-level
 * shortcuts and the wheel handlers that drive volume and the song carousel.
 * Nothing is bound in the capture phase, which is what makes an overlay able to
 * coexist with it:
 *
 * - **Inside the overlay**, {@link isolateInput} stops these events at the
 *   overlay's root while they bubble. The event still reached its target, so a
 *   text field types normally, but it never continues up to `window` - so typing
 *   "speed" into a filter box cannot press four gameplay keys, and scrolling a
 *   results list cannot change the game's volume.
 * - **Outside the overlay**, {@link HotkeyManager} listens in the capture phase,
 *   ahead of every game handler, so a shortcut can claim its combo before
 *   gameplay interprets it.
 */

import type { Disposer } from './addon.js';

/** Events the game acts on globally, which an overlay must not leak upward. */
const ISOLATED_EVENTS = [
	'keydown', 'keyup', 'keypress',
	'wheel',
	'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
] as const;

/**
 * Stop the game from seeing input that belongs to `root`.
 *
 * Bubble phase on purpose: the event has already done its job inside the
 * overlay by the time it is stopped here. Capturing instead would take the
 * keystroke away from the very field the player is typing into.
 */
export const isolateInput = (root: HTMLElement): Disposer => {
	const stop = (event: Event) => event.stopPropagation();
	for (const type of ISOLATED_EVENTS) {
		root.addEventListener(type, stop, { capture: false });
	}
	return () => {
		for (const type of ISOLATED_EVENTS) {
			root.removeEventListener(type, stop, { capture: false });
		}
	};
};

export type Hotkey = {
	/** `KeyboardEvent.key`, compared case-insensitively. */
	key: string;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	meta: boolean;
};

/** Parse `"Ctrl+Shift+F"` into a {@link Hotkey}. Order and case do not matter. */
export const parseHotkey = (combo: string): Hotkey => {
	const parts = combo.split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
	const hotkey: Hotkey = { key: '', ctrl: false, shift: false, alt: false, meta: false };
	for (const part of parts) {
		if (part === 'ctrl' || part === 'control') hotkey.ctrl = true;
		else if (part === 'shift') hotkey.shift = true;
		else if (part === 'alt' || part === 'option') hotkey.alt = true;
		else if (part === 'meta' || part === 'cmd' || part === 'super') hotkey.meta = true;
		else hotkey.key = part;
	}
	if (!hotkey.key) throw new Error(`Hotkey "${combo}" names no key`);
	return hotkey;
};

const matches = (hotkey: Hotkey, event: KeyboardEvent): boolean =>
	event.key.toLowerCase() === hotkey.key
	&& event.ctrlKey === hotkey.ctrl
	&& event.shiftKey === hotkey.shift
	&& event.altKey === hotkey.alt
	&& event.metaKey === hotkey.meta;

/** Whether the event is going somewhere the player is typing. */
const isTextEntry = (target: EventTarget | null): boolean => {
	const el = target as HTMLElement | null;
	if (!el?.tagName) return false;
	return el.tagName === 'INPUT'
		|| el.tagName === 'TEXTAREA'
		|| el.tagName === 'SELECT'
		|| el.isContentEditable;
};

type Binding = { hotkey: Hotkey; handler: (event: KeyboardEvent) => void; allowInText: boolean };

/**
 * Global shortcuts that win against the game.
 *
 * One capture-phase listener on `window` serves every binding. A claimed combo
 * is stopped with `stopImmediatePropagation` and `preventDefault`, so neither
 * the game's handlers nor the browser's own act on it.
 */
export class HotkeyManager {

	private readonly bindings = new Set<Binding>();

	private readonly onKeyDown = (event: KeyboardEvent) => {
		if (event.repeat) return;
		for (const binding of this.bindings) {
			if (!matches(binding.hotkey, event)) continue;
			// A shortcut must not fire while the player is typing - unless it is
			// the combo that closes the overlay they are typing in.
			if (!binding.allowInText && isTextEntry(event.target)) continue;
			event.preventDefault();
			event.stopImmediatePropagation();
			binding.handler(event);
			return;
		}
	};

	constructor() {
		window.addEventListener('keydown', this.onKeyDown, { capture: true });
	}

	/**
	 * Bind a combo. `allowInText` lets it fire even from a focused field, which
	 * is what a close/escape shortcut wants.
	 */
	register(
		combo: string,
		handler: (event: KeyboardEvent) => void,
		{ allowInText = false }: { allowInText?: boolean } = {},
	): Disposer {
		const binding: Binding = { hotkey: parseHotkey(combo), handler, allowInText };
		this.bindings.add(binding);
		return () => this.bindings.delete(binding);
	}

	dispose(): void {
		this.bindings.clear();
		window.removeEventListener('keydown', this.onKeyDown, { capture: true });
	}
}
