/**
 * Bridge to the player's characters.
 *
 * The client stores skills as flat columns on the `character` table - one group
 * per skill (`speed`, `speedXP`, `speedUpgrades`, `speedOverdrive`,
 * `speedPrestige`, ...) - and reconstitutes them into `Skill` objects when it
 * builds its DAO. An add-on reads the row here and reconstitutes them the same
 * way, using the skill factory bundled from the game's own sim, so a simulated
 * play sees exactly the character the player is on.
 *
 * **Which row is "the" character is not obvious, and guessing wrong is quiet.**
 * The table holds two populations:
 *
 * - the **local lineage** (`local = 1`, negative ids) - the Guest and its past
 *   generations. Exactly one carries `current = 1`, set by `makeCurrent()`,
 *   which updates `WHERE local = 1` and so never touches an account character.
 * - **cached account characters** (`local = 0`, the server's own positive ids),
 *   written whenever a signed-in session resolves.
 *
 * So `current = 1` means "the live *guest*", not "the character being played" -
 * reading it while signed in silently returns a much weaker character, and the
 * only symptom is that simulated results come out too low.
 *
 * The client resolves the real answer from session state held in module memory
 * (`Entities.character`), which an add-on cannot read. But the answer is still
 * recoverable from data: every finished play is stored locally with the live
 * character's id, so **the most recent score names the character being played**
 * - across sign-in, sign-out and account switches alike. {@link live} resolves
 * through that, and {@link list} exists so an add-on can still show its choice
 * and let the player correct it.
 */

import { gameDb, type SqlValue } from './db.js';

export type CharacterRow = Record<string, SqlValue> & {
	id: number;
	name: string;
	generation: number;
	overallLevel: number;
	overallTotalXp: number;
	memoryResetAt: number;
	/** 1 for the local guest lineage, 0 for a cached account character. */
	local: number;
	/** Marks the live *guest*; meaningless for account characters. */
	current: number;
};

export const gameCharacter = {

	/**
	 * Every character on this client, account characters first, then the guest
	 * lineage - each list strongest first, which is also the order of "most
	 * likely to be the one being played".
	 */
	async list(): Promise<CharacterRow[]> {
		return gameDb.select<CharacterRow>(`
			SELECT * FROM character
			ORDER BY local ASC, current DESC, overallTotalXp DESC, generation DESC
		`);
	},

	/**
	 * The character being played.
	 *
	 * Resolved in order of how directly each signal answers the question:
	 *
	 * 1. **The most recent stored score's `characterId`.** Plays are saved with
	 *    the live character's id, so this is the game's own record of who was
	 *    playing, and it follows account switches for free.
	 * 2. **A cached account character** (`local = 0`), for a signed-in player who
	 *    has no stored plays yet - a fresh install, or a cleared local database.
	 * 3. **The guest**, for a player who has never signed in.
	 *
	 * Only step 1 is a fact; the rest are inference, so an add-on that acts on
	 * this should still show which character it used.
	 */
	async live(): Promise<CharacterRow | undefined> {
		const lastPlayed = await gameDb.value<number>(
			'SELECT characterId FROM score ORDER BY playedAt DESC LIMIT 1',
		).catch(() => undefined);

		if (typeof lastPlayed === 'number') {
			const played = await this.byId(lastPlayed);
			if (played) return played;
		}

		const account = await gameDb.first<CharacterRow>(
			'SELECT * FROM character WHERE local = 0 ORDER BY overallTotalXp DESC LIMIT 1',
		);
		return account ?? await this.guest();
	},

	/** One character by id. */
	async byId(id: number): Promise<CharacterRow | undefined> {
		return gameDb.first<CharacterRow>('SELECT * FROM character WHERE id = ? LIMIT 1', [id]);
	},

	/**
	 * The live *guest* - the local lineage's current character.
	 *
	 * This is what `current = 1` actually marks. Use it only when you
	 * specifically want the offline character; for "who is playing", use
	 * {@link live}.
	 */
	async guest(): Promise<CharacterRow | undefined> {
		return gameDb.first<CharacterRow>(
			'SELECT * FROM character WHERE local = 1 ORDER BY current DESC, generation DESC LIMIT 1',
		);
	},

	/**
	 * Apply a character row onto skill objects built by the game's factory.
	 *
	 * Mirrors the client's `Character` constructor. `skills` is whatever
	 * `makeOrderedSkills()` returned - typed loosely so this module stays
	 * independent of the bundled sim's own types.
	 */
	applySkills<T extends { name: string } & Record<string, { set(value: never): unknown }>>(
		skills: readonly T[],
		row: CharacterRow,
	): readonly T[] {
		for (const skill of skills) {
			const set = (field: string, column: string) => {
				const value = row[column];
				if (typeof value === 'number') {
					(skill[field] as unknown as { set(v: number): void }).set(value);
				}
			};
			set('level', skill.name);
			set('xp', `${skill.name}XP`);
			set('upgrades', `${skill.name}Upgrades`);
			set('overdrive', `${skill.name}Overdrive`);
			set('prestige', `${skill.name}Prestige`);
		}
		return skills;
	},
};
