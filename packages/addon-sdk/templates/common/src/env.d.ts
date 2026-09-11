/** Stylesheets are inlined as strings and injected into the overlay's shadow root. */
declare module '*.css' {
	const css: string;
	export default css;
}

/** Workers are inlined into the single-file bundle and spawned from a Blob URL. */
declare module 'worker:*' {
	const createWorker: () => Worker;
	export default createWorker;
}

/** Binary assets inlined as base64 (e.g. `import wasm from './x.wasm?base64'`). */
declare module '*?base64' {
	const base64: string;
	export default base64;
}
