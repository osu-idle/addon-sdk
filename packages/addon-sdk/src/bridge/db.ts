/**
 * Bridge to the game's local database.
 *
 * The client keeps its state in an in-page sql.js database persisted to
 * IndexedDB, and publishes the managed handle as `window.db` (see the client's
 * `db/dao.ts`). An add-on cannot import the client's typed DAOs - it is a
 * separate module graph - so it talks to that handle in raw SQL instead.
 *
 * Reads go through `db.read`; writes go through `db.write`, which is what
 * persists the database back to IndexedDB. Writing with `read` would mutate the
 * in-memory copy only, and the change would vanish on reload.
 */

export type SqlValue = string | number | Uint8Array | null;

/** sql.js result set: column names plus positional rows. */
type ExecResult = { columns: string[]; values: SqlValue[][] };

/** The subset of sql.js's `Database` the bridge relies on. */
type SqlJsDatabase = {
	exec(sql: string, params?: SqlValue[]): ExecResult[];
};

/** The managed handle the client publishes on `window`. */
type GameDb = {
	read<T>(fn: (db: SqlJsDatabase) => T): Promise<T>;
	write<T>(fn: (db: SqlJsDatabase) => T): Promise<T>;
};

const handle = (): GameDb => {
	const db = (window as unknown as { db?: GameDb }).db;
	if (!db?.read) {
		throw new Error(
			'osu!idle database not found on window - the game has not opened it yet, ' +
			'or this add-on is running outside the client.',
		);
	}
	return db;
};

/** Reshape one sql.js result set into plain row objects. */
const toRows = <T>(result: ExecResult[]): T[] => {
	const first = result[0];
	if (!first) return [];
	return first.values.map(row => {
		const out: Record<string, SqlValue> = {};
		first.columns.forEach((column, i) => { out[column] = row[i] ?? null; });
		return out as T;
	});
};

/**
 * The game's database, addressed in SQL. `T` is the caller's assertion about
 * the row shape - the game's schema is not visible to this module graph, so
 * nothing can check it for you; keep queries close to the tables you know.
 */
export const gameDb = {

	/** Every row a query returns. */
	async select<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
		return toRows<T>(await handle().read(db => db.exec(sql, params)));
	},

	/** The first row, or `undefined`. */
	async first<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
		return (await this.select<T>(sql, params))[0];
	},

	/** A single scalar (first column of the first row), or `undefined`. */
	async value<T extends SqlValue>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
		const result = await handle().read(db => db.exec(sql, params));
		return result[0]?.values[0]?.[0] as T | undefined;
	},

	/** One write statement, persisted to IndexedDB. */
	async run(sql: string, params: SqlValue[] = []): Promise<void> {
		await handle().write(db => { db.exec(sql, params); });
	},

	/**
	 * Several statements persisted as one save - cheaper than a `run` each, and
	 * it never leaves the database half-updated on disk.
	 */
	async batch(statements: readonly { sql: string; params?: SqlValue[] }[]): Promise<void> {
		if (!statements.length) return;
		await handle().write(db => {
			for (const { sql, params } of statements) db.exec(sql, params ?? []);
		});
	},

	/** Whether the game has published its database yet. */
	available(): boolean {
		return !!(window as unknown as { db?: GameDb }).db?.read;
	},

	/**
	 * Resolve once the database is published. The client opens it lazily, so an
	 * add-on mounted at boot can easily beat it there.
	 */
	async ready(timeoutMs = 30_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!this.available()) {
			if (Date.now() > deadline) throw new Error('osu!idle database did not open in time');
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	},
};
