// Where the tracker's data comes from, as little from the server as possible (the game's developers asked add-ons
// to store what they fetch rather than fetching it again):
// - your plays: the game's own database on this computer (score and score_xp), never the server;
// - map names, key counts and lengths: the game's map catalogue, kept on this computer (IndexedDB) and fetched again
//   once it's a day old, and right away when you've played a map it doesn't know yet (then again 1 and 5 minutes
//   later; a map still missing after that is left unresolved and isn't asked about again);
// - who you are: the game's API (the character the game is on, asked whenever a new play shows up), and your
//   characters with 7K plays from the game's database (each one's plays, history and strain are kept apart);
// - your strain: the game's API, asked once when a new play shows up (the game keeps no strain per play).

import { gameCharacter, gameDb, type SqlValue } from '@oss-idle/addon-sdk';
import { type MapInfo, type Play, is7kPlay, num, ONLY_7K, parseGains, totalOf } from '../rules/logic.js';
import { restedStrain, strainPerMinute, strainWhenSet } from '../rules/strain.js';
import { type LevelHistory, noteLevels } from '../rules/outdated.js';
import { type MultiplierHistory, baseXp, noteMultipliers, recentOfMap } from '../rules/base.js';
import { TEXT } from '../ui/text.js';

const CATALOG_URL = 'https://api.oss.idle.rhythmgamers.net/v1/beatmap/catalog';
/** How many of your newest plays are read: the tracker shows the 7K ones among them. */
/** The newest 7K plays read (4K plays don't count), reading the database this many rows at a time, at most
 *  READ_BATCHES times. */
const READ_PLAYS = 2000, READ_BATCHES = 20;
const CATALOG_MAX_AGE = 24 * 3600e3, CATALOG_RETRY = 3600e3, CATALOG_TIMEOUT = 20000;
const CACHE_DB = '7k-score-tracker', CACHE_STORE = 'kv', CATALOG_KEY = 'catalog-v4';
/** Catalogues kept before, without what's kept now: removed once the new one is saved. */
const OLD_CATALOG_KEYS = ['catalog-v2', 'catalog-v3'];

/** What the game's API says about a character (`me`, or any of yours by id): who, its strain, and its skills. */
type CharacterAnswer = { character_id?: number, fatigue?: { minutes?: number, at?: string }, warmup?: { bar?: number }, skills?: Record<string, { level?: number, prestige?: number, upgrades?: number, xp_multipliers?: { total?: string } }> };
type Api = {
	me?: (options?: { ruleset?: string }) => Promise<CharacterAnswer | null | undefined>,
	character?: (id: number, options?: { ruleset?: string }) => Promise<CharacterAnswer | null | undefined>,
};
/** id → [title, difficulty, keys, length in seconds, stars, mapper]; when it was fetched and last tried; maps it
 *  didn't have: id → [tries, when to try again]. */
type Catalog = { at: number, tried: number, maps: Record<number, [string, string, number, number, number, string, string?, number?]>, missing?: Record<number, [number, number]> };
/** After the first try for a missing map: wait 1 minute, then 5; then it's unresolved. */
const RETRY_AFTER = [60e3, 300e3];

export class TrackerError extends Error {}

// ---- a small IndexedDB store, opened once; without it the tracker simply fetches as needed ----

let cacheDb: Promise<IDBDatabase | null> | undefined;
const openCache = () => cacheDb ?? (cacheDb = new Promise((resolve) => {
	try {
		const req = indexedDB.open(CACHE_DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => resolve(null);
		req.onblocked = () => resolve(null);
	} catch {
		resolve(null);
	}
}));

const cacheGet = async <T>(key: string): Promise<T | undefined> => {
	const db = await openCache();
	if (!db) return undefined;
	return new Promise((resolve) => {
		try {
			const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
			req.onsuccess = () => resolve(req.result as T | undefined);
			req.onerror = () => resolve(undefined);
		} catch {
			resolve(undefined);
		}
	});
};

const cacheSet = async (key: string, value: unknown): Promise<void> => {
	const db = await openCache();
	if (!db) return;
	try { db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put(value, key); } catch { /* memory only */ }
};

const cacheDelete = async (key: string): Promise<void> => {
	const db = await openCache();
	if (!db) return;
	try { db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).delete(key); } catch { /* nothing to remove */ }
};

// ---- the map catalogue ----

let catalog: Catalog | null = null;

const fetchCatalog = async (): Promise<Catalog> => {
	const maps: Catalog['maps'] = {};
	const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT) });
	if (!res.ok) throw new Error(`catalogue: ${res.status}`);
	const walk = (v: unknown): void => {
		if (!v || typeof v !== 'object') return;
		if (Array.isArray(v)) { v.forEach(walk); return; }
		const o = v as { id?: number, title?: string, artist?: string, creator?: string, versions?: { id?: number, version?: string, keys?: number, total_length?: number, difficulty?: number }[] };
		if (Array.isArray(o.versions) && o.title) {
			for (const d of o.versions) if (d && d.id) maps[d.id] = [o.title, d.version ?? '', num(d.keys), num(d.total_length) / 1000, num(d.difficulty), o.creator ?? '', o.artist ?? '', num(o.id)];
		}
		for (const [k, child] of Object.entries(o)) if (k !== 'versions') walk(child);
	};
	walk(await res.json());
	const now = Date.now();
	return { at: now, tried: now, maps };
};

/** The catalogue: from memory, else this computer, fetched again when it's old or misses a map you played. */
const mapCatalog = async (played: number[]): Promise<Catalog> => {
	catalog ??= (await cacheGet<Catalog>(CATALOG_KEY)) ?? { at: 0, tried: 0, maps: {} };
	const now = Date.now();
	const missing = { ...catalog.missing };
	// maps it doesn't know whose next try is due (one that's run out of tries is unresolved)
	const due = played.filter((id) => !catalog!.maps[id] && (missing[id]?.[0] ?? 0) <= RETRY_AFTER.length && now >= (missing[id]?.[1] ?? 0));
	const old = now - catalog.at > CATALOG_MAX_AGE && now - catalog.tried > CATALOG_RETRY;
	if (!old && !due.length) return catalog;
	let next: Catalog;
	try {
		next = await fetchCatalog();
		// a catalogue fetched before: its new 7K maps are news (MySpace Mode)
		if (catalog.at) noteNewMaps(Object.keys(next.maps).map(Number).filter((id) => !catalog!.maps[id] && next.maps[id]![2] === 7), now);
	} catch {
		// unreachable: keep what's stored (it counts as a try)
		next = { ...catalog, tried: now };
	}
	for (const id of Object.keys(missing)) if (next.maps[Number(id)]) delete missing[Number(id)];
	for (const id of due) {
		if (next.maps[id]) continue;
		const tries = (missing[id]?.[0] ?? 0) + 1;
		missing[id] = [tries, now + (RETRY_AFTER[tries - 1] ?? 0)];
	}
	catalog = { ...next, missing };
	void cacheSet(CATALOG_KEY, catalog);
	for (const key of OLD_CATALOG_KEYS) void cacheDelete(key);
	return catalog;
};

// ---- new maps: 7K maps the catalogue didn't have before, and when they showed up (kept on this computer) ----

const NEW_MAPS_KEY = '7k-score-tracker:new-maps';
/** How many new maps are kept, and for how long they're news. */
const NEW_MAPS_KEEP = 20, NEW_MAPS_FOR = 3 * 864e5;
const readNewMaps = (): [number, number][] => {
	try {
		const v = JSON.parse(localStorage.getItem(NEW_MAPS_KEY) ?? '[]') as unknown;
		return Array.isArray(v) ? v.filter((x): x is [number, number] => Array.isArray(x) && x.length === 2) : [];
	} catch { return []; }
};
const noteNewMaps = (ids: number[], at: number) => {
	if (!ids.length) return;
	try { localStorage.setItem(NEW_MAPS_KEY, JSON.stringify([...ids.map((id) => [id, at]), ...readNewMaps()].slice(0, NEW_MAPS_KEEP))); } catch { /* not kept */ }
};
/** The songs of the 7K maps that showed up in the catalogue in the past 3 days, newest first, each once. */
export const newMaps = async (now = Date.now()): Promise<string[]> => {
	const recent = readNewMaps().filter(([, at]) => now - at < NEW_MAPS_FOR);
	if (!recent.length) return [];
	const cat = await mapCatalog([]);
	return [...new Set(recent.map(([id]) => cat.maps[id]?.[0]).filter((t): t is string => !!t))];
};

const infoOf = (cat: Catalog, id: number): MapInfo | undefined => {
	const m = cat.maps[id];
	return m ? { title: m[0], difficulty: m[1], keys: m[2], lengthSec: m[3], stars: num(m[4]), mapper: m[5] ?? '', artist: m[6] ?? '', set: num(m[7]) } : undefined;
};

// ---- your plays ----

/** The character the game is on (its API's `me`; a rebirth or a switch in the game moves it), the one picked in the
 *  switcher (0: the game's), and the guest's, for a player who never signed in. */
let gameId = 0, viewId = 0, guestId = 0;
/** The character the plays were read for (the playlist is saved for it too). */
let playingAs = 0;
/** The character the lists show: the one picked, else the game's. */
export const shownCharacter = (): number => viewId || gameId || guestId;
/** The character the game is on (0 before its API answered). */
export const gameCharacterId = (): number => gameId;
/** Shows a character's plays (0, or the game's own: follows the game again). */
export const viewCharacter = (id: number): void => { viewId = id === gameId ? 0 : id; };

/** A character in the switcher: name and generation from the game's database (unknown for one it doesn't keep). */
export type CharacterInfo = { id: number, name: string, generation: number };
let with7k: { at: number, ids: number[] } = { at: 0, ids: [] };
/** Your characters with 7K plays (any play that gave a 7K-only skill XP), newest played first; read again after a minute. */
export const sevenKCharacters = async (): Promise<number[]> => {
	if (Date.now() - with7k.at < 60e3) return with7k.ids;
	const rows = await rowsOf(`SELECT characterId AS id, MAX(playedAt) AS at FROM score_xp WHERE ${ONLY_7K.map(() => 'gains LIKE ?').join(' OR ')} GROUP BY characterId ORDER BY at DESC`, ONLY_7K.map((sk) => `%"${sk}"%`));
	if (rows) with7k = { at: Date.now(), ids: rows.map((r) => num(r.id)).filter(Boolean) };
	return with7k.ids;
};
/** The switcher's characters: yours with 7K plays (and the shown one), with their names where the game keeps them. */
export const characterList = async (): Promise<CharacterInfo[]> => {
	const ids = [...new Set([...await sevenKCharacters(), shownCharacter()].filter(Boolean))];
	const rows = await gameCharacter.list().catch(() => []);
	return ids.map((id) => {
		const r = rows.find((x) => num(x.id) === id);
		return { id, name: r ? String(r.name) : '', generation: num(r?.generation) || 1 };
	});
};

/** Rows from the game's database (through the SDK, on its read path), or null while the game hasn't opened it. */
const rowsOf = async (sql: string, params: SqlValue[]): Promise<Record<string, SqlValue>[] | null> => {
	try {
		await gameDb.ready();
	} catch {
		return null;
	}
	return gameDb.select(sql, params);
};

/** A cheap mark of the newest play and the newest XP saved: when it changes, there is something new to show. */
export const latestMark = async (): Promise<string> => {
	const rows = await rowsOf('SELECT (SELECT MAX(id) FROM score) AS s, (SELECT MAX(scoreId) FROM score_xp) AS x', []);
	return rows?.[0] ? `${String(rows[0].s)}:${String(rows[0].x)}` : '';
};

/** Your recent 7K plays, newest first, each with its XP per skill and its map: the shown character's, or with `of`,
 *  that character's (then only plays from `from` on). */
export const recent7k = async (api: Api | undefined, of = 0, from = 0): Promise<Play[]> => {
	if (!of && !gameId) gameId = num((await askMe(api))?.character_id);
	if (!of && !shownCharacter()) guestId = num((await gameCharacter.live().catch(() => undefined))?.id);
	const id = of || shownCharacter();
	if (!id) throw new TrackerError(TEXT.errors.noCharacter);
	if (!of) playingAs = id;
	// newest first, a batch at a time, until READ_PLAYS 7K plays are found (4K plays are read, then left out)
	const out: Play[] = [];
	let cat: Catalog | undefined;
	for (let batch = 0; batch < READ_BATCHES && out.length < READ_PLAYS; batch++) {
		const rows = await rowsOf(
			`SELECT s.beatmapId AS beatmapId, s.playedAt AS playedAt, s.rate AS rate, s.mods AS mods, s.unranked AS unranked, s.pp AS pp, s.accuracy AS acc, s.MISS AS misses, x.gains AS gains
			 FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
			 WHERE s.characterId = ? AND s.playedAt >= ? ORDER BY s.playedAt DESC, s.id DESC LIMIT ? OFFSET ?`, [id, from, READ_PLAYS, batch * READ_PLAYS]);
		if (rows === null) throw new TrackerError(TEXT.errors.noDatabase);
		const parsed = rows.map((r) => ({ r, gains: parseGains(r.gains) }));
		// the first batch only: maps that can make the catalogue look out of date (ranked plays, as unranked maps are
		// never in it, that gave 7K skills or no XP at all, so their mode is unknown)
		cat ??= await mapCatalog([...new Set(parsed.filter((p) => !num(p.r.unranked) && (!totalOf(p.gains) || ONLY_7K.some((sk) => num(p.gains[sk]) > 0))).map((p) => num(p.r.beatmapId)))]);
		for (const { r, gains } of parsed) {
			const info = infoOf(cat, num(r.beatmapId));
			if (!is7kPlay(info, gains)) continue;
			out.push({ beatmapId: num(r.beatmapId), playedAt: num(r.playedAt), rate: num(r.rate) || 1, mods: String(r.mods ?? ''), gains, info, total: totalOf(gains), pp: num(r.pp), xpSaved: r.gains != null, acc: num(r.acc), misses: num(r.misses) });
		}
		if (rows.length < READ_PLAYS) break;
	}
	return out.slice(0, READ_PLAYS);
};

/** Where All Time Highest's plays came from, for the debug view. */
let everFrom: Record<string, unknown> = { source: 'not read yet' };
/**
 * All Time Highest: every 7K map's best play at each rate, however old (not only the plays read above), with `n` the
 * plays at that rate. The database finds each best (the most XP in all: at one map and rate, the most a minute too)
 * with its JSON functions; null when it can't (then the newest plays are used instead).
 */
export const allTime7k = async (): Promise<Play[] | null> => {
	const id = playingAs || shownCharacter();
	if (!id) return null;
	let rows: Record<string, SqlValue>[] | null;
	try {
		rows = await rowsOf(
			`SELECT s.beatmapId AS beatmapId, s.rate AS rate, s.playedAt AS playedAt, s.mods AS mods, s.pp AS pp, x.gains AS gains,
			 MAX((SELECT TOTAL(value) FROM json_each(x.gains))) AS total, COUNT(*) AS n
			 FROM score s JOIN score_xp x ON x.scoreId = s.id
			 WHERE s.characterId = ? GROUP BY s.beatmapId, s.rate`, [id]);
	} catch (e) {
		everFrom = { source: 'your newest plays', why: `the database couldn't find the best plays: ${String(e)}` };
		return null;
	}
	if (rows === null) return null;
	const cat = await mapCatalog([]);
	const out: Play[] = [];
	for (const r of rows) {
		const gains = parseGains(r.gains), info = infoOf(cat, num(r.beatmapId));
		if (!is7kPlay(info, gains)) continue;
		out.push({ beatmapId: num(r.beatmapId), playedAt: num(r.playedAt), rate: num(r.rate) || 1, mods: String(r.mods ?? ''), gains, info, total: totalOf(gains), pp: num(r.pp), xpSaved: true, n: num(r.n) || 1 });
	}
	everFrom = { source: 'the database, all plays', maps: out.length };
	return out;
};

// ---- your playlist ----

/**
 * Saves maps (best first) into the game playlist named `name` (7KST: …), and returns its id: a playlist of that name
 * has its maps replaced, else a new one is made. Only that playlist is ever written: the others are never touched.
 * `oldNames`: what earlier versions called it; with none of the new name yet, the newest of those is renamed and used.
 */
export const savePlaylist = async (name: string, maps: { beatmapId: number, rate: number, repeat?: number }[], oldNames: string[] = []): Promise<number> => {
	if (!playingAs) throw new TrackerError(TEXT.errors.noCharacter);
	let playlist = num(await gameDb.value('SELECT MAX(id) FROM playlist WHERE name = ? AND characterId = ?', [name, playingAs]));
	if (!playlist && oldNames.length) {
		playlist = num(await gameDb.value(`SELECT MAX(id) FROM playlist WHERE name IN (${oldNames.map(() => '?').join(', ')}) AND characterId = ?`, [...oldNames, playingAs]));
		if (playlist) await gameDb.run('UPDATE playlist SET name = ? WHERE id = ?', [name, playlist]);
	}
	if (!playlist) {
		const at = Date.now();
		await gameDb.run('INSERT INTO playlist (name, createdAt, characterId) VALUES (?, ?, ?)', [name, at, playingAs]);
		playlist = num(await gameDb.value('SELECT MAX(id) FROM playlist WHERE name = ? AND createdAt = ? AND characterId = ?', [name, at, playingAs]));
		if (!playlist) throw new Error('playlist: not created');
	}
	// one save: the maps replaced
	await gameDb.batch([
		{ sql: 'DELETE FROM playlist_entry WHERE playlistId = ?', params: [playlist] },
		...maps.map((m, i) => ({
			sql: "INSERT INTO playlist_entry (playlistId, beatmapId, rate, mods, position, repeat) VALUES (?, ?, ?, '', ?, ?)",
			params: [playlist, m.beatmapId, m.rate, i + 1, Math.max(1, Math.round(m.repeat ?? 1))],
		})),
	]);
	return playlist;
};

// ---- your strain, per play ----

const STRAIN_KEY = '7k-score-tracker:strain';
/** How many plays' strain is kept: the newest. */
const STRAIN_KEEP = 2000;
/** How many checks to wait for the game to count a new play's strain, when it hasn't changed yet. */
const STRAIN_WAITS = 6;
/** A play's time and the game's strain time count as the same play this close together. */
const STRAIN_NEAR = 3 * 60e3;
/** The strain as the game last set it (at the end of a play) and when, and each play's change per minute of its
 *  map (by when it was played); `prior` is the one before `game`. `last` was 0.1.35's, taken when the tracker checked: no longer used. */
type StrainStore = { game?: [minutes: number, at: number], prior?: [minutes: number, at: number], last?: unknown, waits?: number, plays: Record<number, number | StrainPlay> };
/** A play's strain: the change per minute of the map (`v`) and the strain bar after it (0-1). 0.1.35 kept only the
 *  change, as a number; 0.1.36 also how much of the map strained you (`strained`, no longer used). */
export type StrainPlay = { v?: number, bar?: number, strained?: number, len?: number };
const strainStores = new Map<number, StrainStore>();

// ---- your skills' levels and prestige, for outdated plays ----

// Each character's history is kept apart, under its key and the character's id (`…:levels:123`). Before characters
// were told apart there was one, under the key alone: the game's character (the first one asked) takes it over.
const LEVELS_KEY = '7k-score-tracker:levels';
const levels = new Map<number, LevelHistory>();
const MULTIPLIERS_KEY = '7k-score-tracker:multipliers';
const multipliers = new Map<number, MultiplierHistory>();

/** A character's store, read once: its own key, else (the game's character only) the one from before characters were
 *  told apart, moved to its key. */
const storeOf = <T>(key: string, cache: Map<number, T>, id: number, ok: (v: unknown) => v is T, empty: () => T): T => {
	const kept = cache.get(id);
	if (kept) return kept;
	let value = empty();
	try {
		const own = JSON.parse(localStorage.getItem(`${key}:${id}`) ?? 'null') as unknown;
		const old = id && id === gameId ? JSON.parse(localStorage.getItem(key) ?? 'null') as unknown : null;
		if (ok(own)) value = own;
		else if (ok(old)) {
			value = old;
			localStorage.setItem(`${key}:${id}`, JSON.stringify(old));
			localStorage.removeItem(key);
		}
	} catch { /* no storage: start empty */ }
	cache.set(id, value);
	return value;
};
const saveStore = (key: string, id: number, value: unknown) => {
	try { localStorage.setItem(`${key}:${id}`, JSON.stringify(value)); } catch { /* kept for this session only */ }
};
const isObject = <T>(v: unknown): v is T => !!v && typeof v === 'object';

/** Each skill's XP multiplier as it changed (rules/base.js), for base XP: the shown character's, or `id`'s. */
export const multiplierHistory = (id = shownCharacter()): MultiplierHistory => storeOf(MULTIPLIERS_KEY, multipliers, id, isObject<MultiplierHistory>, () => ({}));

/** Maps' names and lengths from the catalogue, by id (undefined for one it doesn't know): one it doesn't know has the
 *  catalogue fetched again, like a map you played (a map newer than the stored catalogue, shared by someone else). */
export const mapInfos = async (ids: number[]): Promise<Record<number, MapInfo | undefined>> => {
	const cat = await mapCatalog(ids);
	return Object.fromEntries(ids.map((id) => [id, infoOf(cat, id)]));
};

/** Each play's base XP (its XP with your bonuses taken back out), or why it can't be used: newest first, as `plays`
 *  (the shown character's, or `id`'s). */
export const basePlays = (plays: Play[], id = shownCharacter()) => plays.map((p, i) => ({ play: p, ...baseXp(p, { history: multiplierHistory(id), recent: recentOfMap(plays, i), bar: strainOf(p.playedAt, id)?.bar }) }));

/** Each skill's level and prestige as they changed (rules/outdated.js): the shown character's, or `id`'s. */
export const levelHistory = (id = shownCharacter()): LevelHistory => storeOf(LEVELS_KEY, levels, id, isObject<LevelHistory>, () => ({}));

// ---- for the debug view: the game's API calls, and the newest plays ----

const API_LOG_KEY = 'api-log';
/** How many API calls the debug view keeps (newest first). */
const API_LOG_KEEP = 100;
/** How many plays the debug view shows (the newest 7K ones), and how many of your newest plays it reads to find them. */
const DEBUG_PLAYS = 100, DEBUG_READ = 500;
type ApiCall = { at: number, call: string, ms: number, answer?: unknown, error?: string };
let apiLog: Promise<ApiCall[]> | undefined;

/** The call log, read once from this computer (the tracker's own store, so it doesn't fill the game's storage). */
const apiLogOf = () => (apiLog ??= cacheGet<ApiCall[]>(API_LOG_KEY).then((d) => (Array.isArray(d) ? d : [])));

/** The game's `api.me` for 7K (or with `id`, `api.character` for that character), kept in the debug view's call log;
 *  null when it isn't there or fails. The game's character is noted from `me`. */
const askMe = async (api: Api | undefined, id = 0) => {
	const ask = id ? api?.character && (() => api.character!(id, { ruleset: 'mania7k' })) : api?.me && (() => api.me!({ ruleset: 'mania7k' }));
	if (!ask) return null;
	const at = Date.now(), entry: ApiCall = { at, call: id ? `character(${id}, { ruleset: 'mania7k' })` : "me({ ruleset: 'mania7k' })", ms: 0 };
	let me: CharacterAnswer | null = null;
	try {
		me = (await ask()) ?? null;
		entry.answer = me;
		if (!id && num(me?.character_id)) gameId = num(me?.character_id);
	} catch (e) {
		entry.error = String(e);
	}
	entry.ms = Date.now() - at;
	const log = await apiLogOf();
	log.unshift(entry);
	log.splice(API_LOG_KEEP);
	void cacheSet(API_LOG_KEY, log);
	return me;
};

/** Your strain now and your Stamina upgrades (which move Peak), from the game's last answer, rested a minute per
 *  minute since; undefined before the game was asked. */
export const strainNow = async (): Promise<{ minutes: number, upgrades: number } | undefined> => {
	const id = shownCharacter();
	const call = (await apiLogOf()).find((c) => c.answer && num((c.answer as CharacterAnswer).character_id) === id);
	const me = call?.answer as { fatigue?: { minutes?: number }, skills?: { stamina?: { upgrades?: number } } } | undefined;
	const minutes = me?.fatigue?.minutes;
	if (!call || typeof minutes !== 'number') return undefined;
	return { minutes: restedStrain(minutes, (Date.now() - call.at) / 60e3), upgrades: num(me?.skills?.stamina?.upgrades) };
};

/** Everything the debug view shows: the last 100 API calls, the strain store, the catalogue, and the newest plays with
 *  every column the game keeps, their map and their noted strain. Read only from this computer. */
export const debugData = async (keep?: (info: MapInfo | undefined, beatmapId: number, rate: number, gains: Play['gains'], playedAt: number) => boolean): Promise<Record<string, unknown>> => {
	const id = playingAs || shownCharacter(), s = strainStoreOf(id);
	const cat = await mapCatalog([]);
	const rows = id ? await rowsOf(
		`SELECT s.*, x.gains AS xpGains FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
		 WHERE s.characterId = ? ORDER BY s.playedAt DESC LIMIT ?`, [id, DEBUG_READ]) : null;
	const time = (t: unknown) => (num(t) ? new Date(num(t)).toISOString() : t);
	return {
		api: (await apiLogOf()).map((c) => ({ ...c, at: time(c.at), atMs: c.at })),
		levels: levelHistory(id),
		multipliers: multiplierHistory(id),
		allTime: everFrom,
		strain: { game: s.game && { minutes: s.game[0], at: time(s.game[1]) }, prior: s.prior && { minutes: s.prior[0], at: time(s.prior[1]) }, waits: s.waits ?? 0, playsNoted: Object.keys(s.plays).length },
		catalog: { maps: Object.keys(cat.maps).length, fetchedAt: time(cat.at), triedAt: time(cat.tried), missing: cat.missing ?? {} },
		character: id,
		// 7K plays only, as in the lists
		// (with a search, only those that fit it)
		plays: rows === null ? 'the game database is not open' : rows.filter((r) => {
			const info = infoOf(cat, num(r.beatmapId)), gains = parseGains(r.xpGains);
			return is7kPlay(info, gains) && (!keep || keep(info, num(r.beatmapId), num(r.rate) || 1, gains, num(r.playedAt)));
		}).slice(0, DEBUG_PLAYS).map((r) => debugPlayOf(cat, r)),
	};
};

/** A play as the debug view shows it: every column the game keeps, its map, and its strain as the tracker noted it
 *  (the bar after the play, 0-1, and the change per minute of the map). */
const debugPlayOf = (cat: Catalog, r: Record<string, SqlValue>) => {
	const at = num(r.playedAt);
	return { ...r, playedAt: new Date(at).toISOString(), playedAtMs: at, map: infoOf(cat, num(r.beatmapId)) ?? 'not in the catalogue', strain: strainOf(at, num(r.characterId)) ?? 'not noted' };
};
/** One play (by when it was played and its map) as the debug view shows it, read as the debug view reads them (the
 *  newest 500, matched here rather than in the query, so the time compares as the lists read it); null when it isn't
 *  found. */
export const debugPlay = async (playedAt: number, beatmapId: number): Promise<Record<string, unknown> | null> => {
	const id = playingAs || shownCharacter();
	if (!id) return null;
	const rows = await rowsOf(
		`SELECT s.*, x.gains AS xpGains FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
		 WHERE s.characterId = ? ORDER BY s.playedAt DESC LIMIT ?`, [id, DEBUG_READ]);
	const row = rows?.find((r) => num(r.playedAt) === playedAt && num(r.beatmapId) === beatmapId);
	return row ? debugPlayOf(await mapCatalog([]), row) : null;
};

/** A character's strain store: the shown character's, or `id`'s. */
const strainStoreOf = (id = shownCharacter()): StrainStore =>
	storeOf(STRAIN_KEY, strainStores, id, (s): s is StrainStore => isObject<StrainStore>(s) && typeof s.plays === 'object', () => ({ plays: {} }));
const saveStrain = (id: number, s: StrainStore) => {
	const at = Object.keys(s.plays).map(Number).sort((a, b) => b - a);
	for (const old of at.slice(STRAIN_KEEP)) delete s.plays[old];
	saveStore(STRAIN_KEY, id, s);
};

/** True while a character's newest play waits for the game to count its strain (checked again on the next tick). */
export const strainWaiting = (): boolean => [...strainStores.values()].some((s) => (s.waits ?? 0) > 0);

/** A play's strain (the shown character's, or `id`'s), or undefined when it wasn't noted (played before the tracker
 *  noted strain). */
export const strainOf = (playedAt: number, id = shownCharacter()): StrainPlay | undefined => {
	const x = strainStoreOf(id).plays[playedAt];
	return typeof x === 'number' ? { v: x } : x;
};

/** How long a character's play counts as new enough to ask the game about its strain (others play while you watch one). */
const NOTE_WITHIN = 864e5;

/**
 * Notes each character's newest play's strain: the bar after it, and the change from the strain its last play left
 * (rested until this one started) per minute of the map. The game's character is asked every time (its levels and
 * bonuses too); your other characters with 7K plays only when they have a play not noted yet (or waiting for its
 * strain), as they play at the same time.
 * Called when a new play shows up (and when the tracker opens). True when a play was noted.
 */
export const noteStrain = async (api: Api | undefined): Promise<boolean> => {
	const me = await askMe(api);
	let noted = me ? await noteFor(me) : false;
	if (!api?.character) return noted;
	for (const id of await sevenKCharacters()) {
		if (id === gameId) continue;
		const s = strainStoreOf(id);
		const newest = num((await rowsOf('SELECT MAX(playedAt) AS at FROM score WHERE characterId = ?', [id]))?.[0]?.at);
		if (!newest || ((newest in s.plays || Date.now() - newest > NOTE_WITHIN) && !(s.waits ?? 0))) continue;
		const answer = await askMe(api, id);
		if (answer && (await noteFor({ ...answer, character_id: id }))) noted = true;
	}
	return noted;
};

/** Notes one character's newest play's strain, levels and bonuses from the game's answer about it. */
const noteFor = async (me: CharacterAnswer): Promise<boolean> => {
	// the game gives the strain now (rested since `at`, the end of the last play, a minute per minute), so the
	// strain it set at `at` is that plus the rest since: kept from the first check after `at` only, as later checks
	// would rest it again
	const now = me?.fatigue?.minutes, setAt = Date.parse(String(me?.fatigue?.at ?? ''));
	const id = num(me?.character_id);
	if (typeof now !== 'number' || !Number.isFinite(setAt) || !id) return false;
	const s = strainStoreOf(id);
	// when the game sets a new strain, the one it had is the one before it
	if (!s.game || s.game[1] !== setAt) {
		if (s.game) s.prior = s.game;
		s.game = [strainWhenSet(now, (Date.now() - setAt) / 60e3), setAt];
	}
	const minutes = s.game[0];
	delete s.last;
	const newest = (await rowsOf('SELECT playedAt, beatmapId, rate FROM score WHERE characterId = ? ORDER BY playedAt DESC LIMIT 1', [id]))?.[0];
	const at = num(newest?.playedAt);
	// the skills' levels and prestige: a change is the newest play's doing
	if (me?.skills && noteLevels(levelHistory(id), me.skills, at || Date.now())) saveStore(LEVELS_KEY, id, levelHistory(id));
	// the XP multipliers: from when they were seen (a change comes from an upgrade bought, not from a play)
	if (me?.skills && noteMultipliers(multiplierHistory(id), me.skills, Date.now())) saveStore(MULTIPLIERS_KEY, id, multiplierHistory(id));
	if (newest && !(at in s.plays)) {
		const info = infoOf(await mapCatalog([]), num(newest.beatmapId));
		const lengthMin = info && info.lengthSec > 0 ? info.lengthSec / (num(newest.rate) || 1) / 60 : 0;
		// the game's strain is this play's when it was set as the play ended (closer than half the map)
		const near = Math.abs(setAt - at) <= Math.min(STRAIN_NEAR, lengthMin * 30e3);
		// not yet: the game hasn't counted the play's strain, wait a check
		if (lengthMin && !near && setAt < at && (s.waits ?? 0) < STRAIN_WAITS) {
			s.waits = (s.waits ?? 0) + 1;
			saveStrain(id, s);
			return false;
		}
		if (near) {
			// the bar after the play, as the game shows it
			const bar = me?.warmup?.bar;
			const play: StrainPlay = typeof bar === 'number' ? { bar: Math.round(bar * 1000) / 1000 } : {};
			// before = the strain the last play left, rested until this play started; after = this play's
			const before = s.prior, start = setAt - lengthMin * 60e3;
			const was = before && before[1] < setAt ? restedStrain(before[0], (start - before[1]) / 60e3) : undefined;
			if (was !== undefined) play.v = Math.round(strainPerMinute(was, minutes, lengthMin) * 100) / 100;
			s.plays[at] = play;
			s.waits = 0;
			saveStrain(id, s);
			return true;
		}
	}
	s.waits = 0;
	saveStrain(id, s);
	return false;
};
