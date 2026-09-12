/**
 * Bridge to the player's playlists.
 *
 * A playlist is local to the client's sql.js database: one `playlist` row and
 * one `playlist_entry` per difficulty, keyed on `(playlistId, beatmapId)`.
 *
 * **Writes must go through {@link gameDb}'s write path.** It persists the
 * database back to IndexedDB; a mutation issued on the read side applies to the
 * in-memory copy and is gone at the next reload, with nothing to show for it in
 * between.
 *
 * **A write here does not refresh the client's own views.** They re-query on a
 * version counter the client bumps itself, which lives in module state an
 * add-on cannot reach - so song select keeps showing the list it last read
 * until something else makes it re-read. Tell the player to reopen song select
 * rather than leaving them to wonder why nothing changed.
 */

import { gameDb } from './db.js';

export type PlaylistRow = { id: number; name: string; createdAt: number };

export const playlists = {

	/** Every playlist, with how many difficulties each holds. */
	async list(): Promise<(PlaylistRow & { count: number })[]> {
		return gameDb.select<PlaylistRow & { count: number }>(`
			SELECT p.id, p.name, p.createdAt,
			       (SELECT COUNT(*) FROM playlist_entry e WHERE e.playlistId = p.id) AS count
			FROM playlist p
			ORDER BY p.createdAt DESC
		`);
	},

	/**
	 * The playlist with this name, oldest first.
	 *
	 * The game does not enforce unique playlist names - `Playlist.create` inserts
	 * whatever it is given - so a player can hold two called the same thing.
	 * Ordering by id makes the choice deterministic: regenerating a playlist
	 * keeps overwriting the same one instead of picking arbitrarily.
	 */
	async byName(name: string): Promise<PlaylistRow | undefined> {
		return gameDb.first<PlaylistRow>(
			'SELECT * FROM playlist WHERE name = ? ORDER BY id ASC LIMIT 1',
			[name],
		);
	},

	/** The difficulty ids in a playlist. */
	async entries(playlistId: number): Promise<number[]> {
		const rows = await gameDb.select<{ beatmapId: number }>(
			'SELECT beatmapId FROM playlist_entry WHERE playlistId = ?',
			[playlistId],
		);
		return rows.map(row => row.beatmapId);
	},

	/**
	 * Create a playlist holding exactly `beatmapIds`, replacing one of the same
	 * name. A generated playlist is regenerated often, so replace is the useful
	 * default - and clearing and refilling in one batch means it is never
	 * persisted in a half-empty state.
	 *
	 * Replacing keeps the existing playlist's **id**, so anything already
	 * pointing at it keeps pointing at it.
	 */
	async replace(
		name: string,
		beatmapIds: readonly number[],
	): Promise<{ id: number; created: boolean }> {
		const existing = await this.byName(name);

		if (existing) {
			await gameDb.batch([
				{ sql: 'DELETE FROM playlist_entry WHERE playlistId = ?', params: [existing.id] },
				...beatmapIds.map(id => ({
					sql: 'INSERT OR REPLACE INTO playlist_entry (playlistId, beatmapId) VALUES (?, ?)',
					params: [existing.id, id] as (string | number)[],
				})),
			]);
			return { id: existing.id, created: false };
		}

		await gameDb.run(
			'INSERT INTO playlist (name, createdAt) VALUES (?, ?)',
			[name, Date.now()],
		);
		const created = await this.byName(name);
		if (!created) throw new Error(`Failed to create playlist "${name}"`);

		if (beatmapIds.length) {
			await gameDb.batch(beatmapIds.map(id => ({
				sql: 'INSERT OR REPLACE INTO playlist_entry (playlistId, beatmapId) VALUES (?, ?)',
				params: [created.id, id] as (string | number)[],
			})));
		}
		return { id: created.id, created: true };
	},

	/** Delete a playlist and its entries. */
	async remove(playlistId: number): Promise<void> {
		await gameDb.batch([
			{ sql: 'DELETE FROM playlist_entry WHERE playlistId = ?', params: [playlistId] },
			{ sql: 'DELETE FROM playlist WHERE id = ?', params: [playlistId] },
		]);
	},
};
