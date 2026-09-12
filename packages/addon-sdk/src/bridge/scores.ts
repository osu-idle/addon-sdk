/**
 * Bridge to the player's play history.
 *
 * Every finished play is stored locally in `score`, stamped with the character
 * that played it and when. That makes this table the only record of what a
 * player has actually been doing - the client's own session state is module
 * memory an add-on cannot read.
 *
 * Both helpers here count plays across the whole library in one query rather
 * than asking per map, because the callers that want counts want all of them.
 */

import { gameDb } from './db.js';

/**
 * Plays of each map by this character since `since`, by beatmap id.
 *
 * Mirrors the client's `Score.countPlays`, which is called per map with the
 * character's `memoryResetAt`: plays from before memory was last prestiged do
 * not count towards it, because that training is what the prestige spent.
 */
export const playCountsSince = async (
	characterId: number,
	since: number,
): Promise<Record<number, number>> => {
	const rows = await gameDb.select<{ beatmapId: number; n: number }>(
		`SELECT beatmapId, COUNT(*) AS n FROM score
		 WHERE characterId = ? AND playedAt >= ?
		 GROUP BY beatmapId`,
		[characterId, since],
	);
	const counts: Record<number, number> = {};
	for (const row of rows) counts[row.beatmapId] = row.n;
	return counts;
};

/**
 * Plays of each map in the last 24 hours, by beatmap id.
 *
 * Mirrors the server's `recentMapPlays`: the last 50 plays inside a 24h window,
 * counted per map. That is the window the server scores repetition over, so an
 * add-on predicting what a play is worth has to read it the same way.
 */
export const recentPlayCounts = async (characterId: number): Promise<Map<number, number>> => {
	const since = Date.now() - 24 * 60 * 60 * 1000;
	const rows = await gameDb.select<{ beatmapId: number }>(
		'SELECT beatmapId FROM score WHERE characterId = ? AND playedAt >= ? ORDER BY playedAt DESC LIMIT 50',
		[characterId, since],
	);
	const counts = new Map<number, number>();
	for (const row of rows) counts.set(row.beatmapId, (counts.get(row.beatmapId) ?? 0) + 1);
	return counts;
};
