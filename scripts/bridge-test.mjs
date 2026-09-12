/**
 * Do the database bridges behave against a real database?
 *
 * Runs the built `playlists` and score helpers against sql.js carrying the
 * client's own schema, with `window.db` stubbed by the same read/write contract
 * the client publishes - so the write path is exercised, not just the SQL.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SQL = await require('sql.js')();
const db = new SQL.Database();

// The client's schema, as its DDL generator emits it.
db.run(`
CREATE TABLE IF NOT EXISTS playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_entry (
  playlistId INTEGER NOT NULL,
  beatmapId INTEGER NOT NULL,
  PRIMARY KEY (playlistId, beatmapId)
);
CREATE INDEX IF NOT EXISTS idx_playlist_entry_beatmap ON playlist_entry(beatmapId);
CREATE TABLE IF NOT EXISTS score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  characterId INTEGER NOT NULL,
  beatmapId INTEGER NOT NULL,
  playedAt INTEGER NOT NULL
);
`);

let writes = 0;
globalThis.window = {
	db: {
		read: async fn => fn(db),
		write: async fn => { writes++; return fn(db); },
	},
};

const dist = join(REPO_ROOT, 'packages/addon-sdk/dist');
const { playlists } = await import(pathToFileURL(join(dist, 'bridge/playlists.js')).href);
const { playCountsSince, recentPlayCounts } =
	await import(pathToFileURL(join(dist, 'bridge/scores.js')).href);

const rows = sql => { const r = db.exec(sql); return r[0] ? r[0].values : []; };
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
	cond ? pass++ : (fail++, console.log('  FAIL:', name, extra));
};

// --- playlists ------------------------------------------------------------

const first = await playlists.replace('Rotation', [101, 102, 103]);
check('reports it created', first.created === true);
check('creates the playlist', rows('SELECT COUNT(*) FROM playlist')[0][0] === 1);
check('inserts every entry', rows('SELECT COUNT(*) FROM playlist_entry')[0][0] === 3);

const second = await playlists.replace('Rotation', [201, 202]);
check('reports it replaced', second.created === false);
check('does NOT create a second playlist', rows('SELECT COUNT(*) FROM playlist')[0][0] === 1);
check('keeps the same playlist id', first.id === second.id, `${first.id} vs ${second.id}`);
check('old entries are gone',
	rows('SELECT beatmapId FROM playlist_entry ORDER BY beatmapId').flat().join() === '201,202');

await playlists.replace('Rotation', [201]);
check('shrinks correctly', rows('SELECT COUNT(*) FROM playlist_entry')[0][0] === 1);

await playlists.replace('Other', [301, 302]);
await playlists.replace('Rotation', [401]);
check('overwriting one leaves the other alone',
	rows("SELECT COUNT(*) FROM playlist_entry e JOIN playlist p ON p.id=e.playlistId WHERE p.name='Other'")[0][0] === 2);

await playlists.replace('Dupes', [501, 501, 502]);
check('duplicate ids collapse',
	rows("SELECT COUNT(*) FROM playlist_entry e JOIN playlist p ON p.id=e.playlistId WHERE p.name='Dupes'")[0][0] === 2);

await playlists.replace("Rob'); DROP TABLE playlist;--", [601]);
check('quotes in names are safe', rows('SELECT COUNT(*) FROM playlist')[0][0] === 4);

await playlists.replace('Empty', []);
check('empty playlist is created with no entries',
	rows("SELECT COUNT(*) FROM playlist_entry e JOIN playlist p ON p.id=e.playlistId WHERE p.name='Empty'")[0][0] === 0);

db.run("INSERT INTO playlist (name, createdAt) VALUES ('Dupe', 1), ('Dupe', 2)");
const dupeIds = rows("SELECT id FROM playlist WHERE name='Dupe' ORDER BY id").flat();
const r1 = await playlists.replace('Dupe', [701]);
const r2 = await playlists.replace('Dupe', [702]);
check('picks the same duplicate every time', r1.id === r2.id, `${r1.id} vs ${r2.id}`);
check('picks the oldest duplicate', r1.id === dupeIds[0], `${r1.id} vs ${dupeIds[0]}`);
check('leaves the other duplicate alone',
	rows(`SELECT COUNT(*) FROM playlist_entry WHERE playlistId=${dupeIds[1]}`)[0][0] === 0);

const listed = await playlists.list();
check('list reports entry counts', listed.find(p => p.name === 'Other')?.count === 2);
check('entries returns the ids', (await playlists.entries(r1.id)).join() === '702');

const removeTarget = await playlists.byName('Empty');
await playlists.remove(removeTarget.id);
check('remove deletes the playlist', (await playlists.byName('Empty')) === undefined);

check('all mutations used the write path', writes > 0, `writes=${writes}`);

// --- scores ---------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const play = (characterId, beatmapId, at) =>
	db.run('INSERT INTO score (characterId, beatmapId, playedAt) VALUES (?, ?, ?)',
		[characterId, beatmapId, at]);

play(1, 900, now - 2 * DAY);      // before the cutoff
play(1, 900, now - 1000);
play(1, 900, now - 2000);
play(1, 901, now - 3000);
play(2, 900, now - 4000);         // another character

const counts = await playCountsSince(1, now - DAY);
check('counts only this character', counts[900] === 2, JSON.stringify(counts));
check('counts per map', counts[901] === 1);
check('ignores plays before the cutoff', Object.values(counts).reduce((a, b) => a + b, 0) === 3);

const recent = await recentPlayCounts(1);
check('recent counts per map', recent.get(900) === 2 && recent.get(901) === 1);
check('recent excludes other characters', !recent.has(902));

console.log(`\n${pass} passed, ${fail} failed  (write-path calls: ${writes})`);
process.exit(fail ? 1 : 0);
