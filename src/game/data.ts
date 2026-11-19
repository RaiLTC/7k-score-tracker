// Where the tracker's data comes from, as little from the server as possible (the game's developers asked add-ons
// to store what they fetch rather than fetching it again):
// - your plays: the game's own database on this computer (score and score_xp), never the server;
// - map names, key counts and lengths: the game's map catalogue, kept on this computer (IndexedDB) and fetched again
//   once it's a day old, and right away when you've played a map it doesn't know yet (then again 1 and 5 minutes
//   later; a map still missing after that is left unresolved and isn't asked about again);
// - who you are: the game's API, asked once per game session;
// - your strain: the game's API, asked once when a new play shows up (the game keeps no strain per play).

import { gameDb, type SqlValue } from '@oss-idle/addon-sdk';
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

type Api = {
	me?: (options?: { ruleset?: string }) => Promise<{ character_id?: number, fatigue?: { minutes?: number, at?: string }, warmup?: { bar?: number }, skills?: Record<string, { level?: number, prestige?: number, xp_multipliers?: { total?: string } }> } | null | undefined>,
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

const infoOf = (cat: Catalog, id: number): MapInfo | undefined => {
	const m = cat.maps[id];
	return m ? { title: m[0], difficulty: m[1], keys: m[2], lengthSec: m[3], stars: num(m[4]), mapper: m[5] ?? '', artist: m[6] ?? '', set: num(m[7]) } : undefined;
};

// ---- your plays ----

let characterId = 0;
/** The character the plays were read for (the playlist is saved for it too). */
let playingAs = 0;

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

/** Your recent 7K plays, newest first, each with its XP per skill and its map. */
export const recent7k = async (api: Api | undefined): Promise<Play[]> => {
	if (!characterId) {
		const me = await askMe(api);
		characterId = num(me?.character_id);
	}
	let id = characterId;
	if (!id) {
		const guest = await rowsOf('SELECT id FROM character WHERE current = 1 LIMIT 1', []);
		id = num(guest?.[0]?.id);
	}
	if (!id) throw new TrackerError(TEXT.errors.noCharacter);
	playingAs = id;
	// newest first, a batch at a time, until READ_PLAYS 7K plays are found (4K plays are read, then left out)
	const out: Play[] = [];
	let cat: Catalog | undefined;
	for (let batch = 0; batch < READ_BATCHES && out.length < READ_PLAYS; batch++) {
		const rows = await rowsOf(
			`SELECT s.beatmapId AS beatmapId, s.playedAt AS playedAt, s.rate AS rate, s.mods AS mods, s.unranked AS unranked, s.pp AS pp, s.accuracy AS acc, s.MISS AS misses, x.gains AS gains
			 FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
			 WHERE s.characterId = ? ORDER BY s.playedAt DESC, s.id DESC LIMIT ? OFFSET ?`, [id, READ_PLAYS, batch * READ_PLAYS]);
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
	const id = playingAs || characterId;
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
let strainStore: StrainStore | undefined;

// ---- your skills' levels and prestige, for outdated plays ----

const LEVELS_KEY = '7k-score-tracker:levels';
let levels: LevelHistory | undefined;
/** Each skill's level and prestige as they changed (rules/outdated.js). */
const MULTIPLIERS_KEY = '7k-score-tracker:multipliers';
let multipliers: MultiplierHistory | undefined;
/** Each skill's XP multiplier as it changed (rules/base.js), for base XP. */
export const multiplierHistory = (): MultiplierHistory => {
	if (multipliers) return multipliers;
	try {
		const h = JSON.parse(localStorage.getItem(MULTIPLIERS_KEY) ?? 'null') as MultiplierHistory | null;
		if (h && typeof h === 'object') return (multipliers = h);
	} catch { /* no storage: start empty */ }
	return (multipliers = {});
};

/** Maps' names and lengths from the catalogue, by id (undefined for one it doesn't know): one it doesn't know has the
 *  catalogue fetched again, like a map you played (a map newer than the stored catalogue, shared by someone else). */
export const mapInfos = async (ids: number[]): Promise<Record<number, MapInfo | undefined>> => {
	const cat = await mapCatalog(ids);
	return Object.fromEntries(ids.map((id) => [id, infoOf(cat, id)]));
};

/** Each play's base XP (its XP with your bonuses taken back out), or why it can't be used: newest first, as `plays`. */
export const basePlays = (plays: Play[]) => plays.map((p, i) => ({ play: p, ...baseXp(p, { history: multiplierHistory(), recent: recentOfMap(plays, i), bar: strainOf(p.playedAt)?.bar }) }));

export const levelHistory = (): LevelHistory => {
	if (levels) return levels;
	try {
		const h = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? 'null') as LevelHistory | null;
		if (h && typeof h === 'object') return (levels = h);
	} catch { /* no storage: start empty */ }
	return (levels = {});
};

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

/** The game's `api.me` for 7K, kept in the debug view's call log; null when it isn't there or fails. */
const askMe = async (api: Api | undefined) => {
	if (!api?.me) return null;
	const at = Date.now(), entry: ApiCall = { at, call: "me({ ruleset: 'mania7k' })", ms: 0 };
	let me = null;
	try {
		me = (await api.me({ ruleset: 'mania7k' })) ?? null;
		entry.answer = me;
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
	const call = (await apiLogOf()).find((c) => c.answer);
	const me = call?.answer as { fatigue?: { minutes?: number }, skills?: { stamina?: { upgrades?: number } } } | undefined;
	const minutes = me?.fatigue?.minutes;
	if (!call || typeof minutes !== 'number') return undefined;
	return { minutes: restedStrain(minutes, (Date.now() - call.at) / 60e3), upgrades: num(me?.skills?.stamina?.upgrades) };
};

/** Everything the debug view shows: the last 100 API calls, the strain store, the catalogue, and the newest plays with
 *  every column the game keeps, their map and their noted strain. Read only from this computer. */
export const debugData = async (keep?: (info: MapInfo | undefined, beatmapId: number, rate: number, gains: Play['gains'], playedAt: number) => boolean): Promise<Record<string, unknown>> => {
	const s = strainStoreOf(), id = playingAs || characterId;
	const cat = await mapCatalog([]);
	const rows = id ? await rowsOf(
		`SELECT s.*, x.gains AS xpGains FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
		 WHERE s.characterId = ? ORDER BY s.playedAt DESC LIMIT ?`, [id, DEBUG_READ]) : null;
	const time = (t: unknown) => (num(t) ? new Date(num(t)).toISOString() : t);
	return {
		api: (await apiLogOf()).map((c) => ({ ...c, at: time(c.at), atMs: c.at })),
		levels: levelHistory(),
		multipliers: multiplierHistory(),
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
	return { ...r, playedAt: new Date(at).toISOString(), playedAtMs: at, map: infoOf(cat, num(r.beatmapId)) ?? 'not in the catalogue', strain: strainOf(at) ?? 'not noted' };
};
/** One play (by when it was played and its map) as the debug view shows it, read as the debug view reads them (the
 *  newest 500, matched here rather than in the query, so the time compares as the lists read it); null when it isn't
 *  found. */
export const debugPlay = async (playedAt: number, beatmapId: number): Promise<Record<string, unknown> | null> => {
	const id = playingAs || characterId;
	if (!id) return null;
	const rows = await rowsOf(
		`SELECT s.*, x.gains AS xpGains FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
		 WHERE s.characterId = ? ORDER BY s.playedAt DESC LIMIT ?`, [id, DEBUG_READ]);
	const row = rows?.find((r) => num(r.playedAt) === playedAt && num(r.beatmapId) === beatmapId);
	return row ? debugPlayOf(await mapCatalog([]), row) : null;
};

const strainStoreOf = (): StrainStore => {
	if (strainStore) return strainStore;
	try {
		const s = JSON.parse(localStorage.getItem(STRAIN_KEY) ?? 'null') as StrainStore | null;
		if (s && typeof s.plays === 'object') return (strainStore = s);
	} catch { /* no storage: start empty */ }
	return (strainStore = { plays: {} });
};
const saveStrain = (s: StrainStore) => {
	const at = Object.keys(s.plays).map(Number).sort((a, b) => b - a);
	for (const old of at.slice(STRAIN_KEEP)) delete s.plays[old];
	try { localStorage.setItem(STRAIN_KEY, JSON.stringify(s)); } catch { /* kept for this session only */ }
};

/** True while the newest play waits for the game to count its strain (checked again on the next tick). */
export const strainWaiting = (): boolean => (strainStoreOf().waits ?? 0) > 0;

/** A play's strain, or undefined when it wasn't noted (played before the tracker noted strain). */
export const strainOf = (playedAt: number): StrainPlay | undefined => {
	const x = strainStoreOf().plays[playedAt];
	return typeof x === 'number' ? { v: x } : x;
};

/**
 * Notes your newest play's strain: the bar after it, and the change from the strain your last play left (rested
 * until this one started) per minute of the map.
 * Called when a new play shows up (and when the tracker opens). True when a play was noted.
 */
export const noteStrain = async (api: Api | undefined): Promise<boolean> => {
	const me = await askMe(api);
	// the game gives your strain now (rested since `at`, the end of your last play, a minute per minute), so the
	// strain it set at `at` is that plus the rest since: kept from the first check after `at` only, as later checks
	// would rest it again
	const now = me?.fatigue?.minutes, setAt = Date.parse(String(me?.fatigue?.at ?? ''));
	const id = num(me?.character_id);
	if (typeof now !== 'number' || !Number.isFinite(setAt) || !id) return false;
	const s = strainStoreOf();
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
	if (me?.skills && noteLevels(levelHistory(), me.skills, at || Date.now())) {
		try { localStorage.setItem(LEVELS_KEY, JSON.stringify(levelHistory())); } catch { /* kept for this session only */ }
	}
	// the XP multipliers: from when they were seen (a change comes from an upgrade bought, not from a play)
	if (me?.skills && noteMultipliers(multiplierHistory(), me.skills, Date.now())) {
		try { localStorage.setItem(MULTIPLIERS_KEY, JSON.stringify(multiplierHistory())); } catch { /* kept for this session only */ }
	}
	if (newest && !(at in s.plays)) {
		const info = infoOf(await mapCatalog([]), num(newest.beatmapId));
		const lengthMin = info && info.lengthSec > 0 ? info.lengthSec / (num(newest.rate) || 1) / 60 : 0;
		// the game's strain is this play's when it was set as the play ended (closer than half the map)
		const near = Math.abs(setAt - at) <= Math.min(STRAIN_NEAR, lengthMin * 30e3);
		// not yet: the game hasn't counted the play's strain, wait a check
		if (lengthMin && !near && setAt < at && (s.waits ?? 0) < STRAIN_WAITS) {
			s.waits = (s.waits ?? 0) + 1;
			saveStrain(s);
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
			saveStrain(s);
			return true;
		}
	}
	s.waits = 0;
	saveStrain(s);
	return false;
};
