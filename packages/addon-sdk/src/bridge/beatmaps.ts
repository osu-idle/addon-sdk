/**
 * Bridge to the game's stored beatmaps.
 *
 * Downloaded sets live in their own IndexedDB database (`beatmaps`), separate
 * from the sql.js state database:
 *
 * - `meta`  - one record per set (`keyPath: 'id'`). The record **is** the set's
 *             metadata, versions and all - the client's `.metadata` property
 *             comes from the `LightBeatmapSet` wrapper it builds afterwards,
 *             not from the stored shape.
 * - `charts`- keyed by set id, holding `Record<beatmapId, osuFileText>`.
 * - `files` - the set's assets (audio, backgrounds). Unused here.
 *
 * Only *downloaded* sets are present: the catalog lists far more than any
 * player holds, and a chart is what the simulation needs, so the add-on's
 * coverage is the player's own library.
 *
 * The database is opened **without a version**. Passing one would trigger an
 * upgrade if the add-on's number ever drifted above the client's, and an
 * upgrade here would wipe or block the player's whole library.
 */

export type StoredVersion = {
	id: number;
	version: string;
	difficulty: number;
	mode: number;
	keys: number;
	total_length: number;
	bpm: number;
	objects: number;
	rice?: number;
	ln?: number;
	[key: string]: unknown;
};

export type StoredSetMeta = {
	id: number;
	title: string;
	artist: string;
	creator: string;
	versions: StoredVersion[];
	[key: string]: unknown;
};

const DB_NAME = 'beatmaps';

let connection: Promise<IDBDatabase> | undefined;

const open = (): Promise<IDBDatabase> => connection ??= new Promise<IDBDatabase>((resolve, reject) => {
	// No version argument - see the note above.
	const request = indexedDB.open(DB_NAME);
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(request.error);
	request.onblocked = () => reject(new Error('beatmap store blocked by another tab'));
}).catch((e: unknown): never => {
	// Don't cache a failed open - the next call retries.
	connection = undefined;
	throw e;
});

const request = <T>(store: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
	open().then(db => new Promise<T>((resolve, reject) => {
		if (!db.objectStoreNames.contains(store)) {
			resolve(undefined as T);
			return;
		}
		const tx = db.transaction(store, 'readonly');
		const req = fn(tx.objectStore(store));
		req.onsuccess = () => resolve(req.result as T);
		req.onerror = () => reject(req.error);
	}));

/** The player's downloaded beatmaps. */
export const beatmapStore = {

	/** Metadata for every stored set. */
	async sets(): Promise<StoredSetMeta[]> {
		const records = await request<StoredSetMeta[]>('meta', s => s.getAll());
		return (records ?? []).filter(record => Array.isArray(record?.versions));
	},

	/** Every stored difficulty, paired with the set it belongs to. */
	async difficulties(): Promise<{ set: StoredSetMeta; version: StoredVersion }[]> {
		const sets = await this.sets();
		return sets.flatMap(set => (set.versions ?? []).map(version => ({ set, version })));
	},

	/** Every chart in one set, keyed by difficulty id. */
	async charts(setId: number): Promise<Record<number, string>> {
		return (await request<Record<number, string>>('charts', s => s.get(setId))) ?? {};
	},

	/** One difficulty's `.osu` text, or `undefined` if the set is not stored. */
	async chart(setId: number, beatmapId: number): Promise<string | undefined> {
		return (await this.charts(setId))[beatmapId];
	},
};
