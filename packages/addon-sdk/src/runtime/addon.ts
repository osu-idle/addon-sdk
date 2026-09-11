/**
 * The add-on contract.
 *
 * osu!idle loads an add-on by turning its `source` into a Blob URL and
 * `import()`ing it in the page realm, then calling the module's `mount` /
 * `unmount` exports - that pair *is* the contract, and nothing else is passed
 * in. Everything a useful add-on needs (the game's database, its beatmap store,
 * the DOM) it reaches for itself, because it runs unsandboxed on the page.
 *
 * Two consequences shape this class:
 *
 * - **Nothing resolves at load time.** The module is a Blob, so it has no base
 *   URL and no import map: every dependency, React included, must already be
 *   inside the single emitted file. That is the bundler's job (`./build`).
 * - **`unmount` must actually undo everything.** Add-ons are enabled, disabled,
 *   updated and uninstalled without a page reload, so a listener or timer left
 *   behind leaks into a game the player keeps playing. {@link Addon} therefore
 *   hands out registration helpers that record their own teardown, and reverses
 *   them for you.
 */

/** A teardown returned by a registration; running it undoes that registration. */
export type Disposer = () => void;

export type AddonMeta = {
	/** Human name, used in log lines and error surfaces. */
	name: string;
	/** The add-on's own semver, mirroring the workshop listing. */
	version?: string;
};

/**
 * Base class for an add-on. Subclass it, implement {@link onMount}, and export
 * the pair the runtime wants with {@link defineAddon}.
 *
 * Anything registered through `this.own`, `this.on`, `this.interval` or
 * `this.timeout` is torn down in reverse order on unmount, so `onUnmount` is
 * only for work those helpers cannot express.
 */
export abstract class Addon {

	protected readonly meta: AddonMeta;

	/** Registered teardowns, newest first when reversed at unmount. */
	private disposers: Disposer[] = [];

	private mounted = false;

	constructor(meta: AddonMeta) {
		this.meta = meta;
	}

	/** Runs when the player enables the add-on (and once per boot thereafter). */
	protected abstract onMount(): void | Promise<void>;

	/** Optional extra teardown, run *before* the registered disposers unwind. */
	protected onUnmount(): void | Promise<void> {}

	/** Record a teardown to run at unmount. Returns it, so it can also be run early. */
	protected own<T extends Disposer>(dispose: T): T {
		this.disposers.push(dispose);
		return dispose;
	}

	/**
	 * Add a DOM listener that is removed at unmount. Defaults to the capture
	 * phase, which is what an overlay wants: the game binds its own handlers on
	 * `window` in the bubble phase, so capturing lets an overlay claim an event
	 * before gameplay ever sees it.
	 */
	protected on<K extends keyof WindowEventMap>(
		target: Window,
		type: K,
		handler: (event: WindowEventMap[K]) => void,
		options?: AddEventListenerOptions,
	): Disposer;
	protected on(
		target: EventTarget,
		type: string,
		handler: EventListenerOrEventListenerObject,
		options?: AddEventListenerOptions,
	): Disposer;
	protected on(
		target: EventTarget,
		type: string,
		handler: EventListenerOrEventListenerObject,
		options: AddEventListenerOptions = { capture: true },
	): Disposer {
		target.addEventListener(type, handler, options);
		return this.own(() => target.removeEventListener(type, handler, options));
	}

	/** `setInterval` that is cleared at unmount. */
	protected interval(handler: () => void, ms: number): Disposer {
		const id = window.setInterval(handler, ms);
		return this.own(() => window.clearInterval(id));
	}

	/** `setTimeout` that is cleared at unmount if it has not fired yet. */
	protected timeout(handler: () => void, ms: number): Disposer {
		const id = window.setTimeout(handler, ms);
		return this.own(() => window.clearTimeout(id));
	}

	/** Prefixed console logger, so a player's console says which add-on spoke. */
	protected get log() {
		const tag = `[${this.meta.name}]`;
		return {
			info: (...args: unknown[]) => console.log(tag, ...args),
			warn: (...args: unknown[]) => console.warn(tag, ...args),
			error: (...args: unknown[]) => console.error(tag, ...args),
		};
	}

	/**
	 * Internal: called by {@link defineAddon}, not by add-on code.
	 *
	 * Public only because `defineAddon` lives outside the class and TypeScript
	 * has no package-private visibility; the underscore marks it as off-limits.
	 */
	async _mount(): Promise<void> {
		if (this.mounted) return;
		this.mounted = true;
		await this.onMount();
	}

	/**
	 * Internal: called by {@link defineAddon}, not by add-on code.
	 *
	 * Every teardown runs even if an earlier one throws - a half-unmounted
	 * add-on that keeps a key handler alive would break the game far more
	 * visibly than a logged error here.
	 */
	async _unmount(): Promise<void> {
		if (!this.mounted) return;
		this.mounted = false;
		try {
			await this.onUnmount();
		} catch (e) {
			this.log.error('onUnmount failed', e);
		}
		const pending = this.disposers.reverse();
		this.disposers = [];
		for (const dispose of pending) {
			try {
				dispose();
			} catch (e) {
				this.log.error('teardown failed', e);
			}
		}
	}
}
