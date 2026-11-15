// Where the tracker's data comes from, as little from the server as possible (the game's developers asked add-ons
// to store what they fetch rather than fetching it again):
// - your plays: the game's own database on this computer (score and score_xp), never the server;
// - map names, key counts and lengths: the game's map catalogue, kept on this computer (IndexedDB) and fetched again
//   once it's a day old, and right away when you've played a map it doesn't know yet (then again 1 and 5 minutes
//   later; a map still missing after that is left unresolved and isn't asked about again);
// - who you are: the game's API, asked once per game session;
// - your strain: the game's API, asked once when a new play shows up (the game keeps no strain per play).

import { gameDb, type SqlValue } from '@oss-idle/addon-sdk';
import { type MapInfo, type Play, is7kPlay, num, ONLY_7K, parseGains, totalOf } from './logic.js';
import { strainPerMinute } from './strain.js';
import { TEXT } from './text.js';

const CATALOG_URL = 'https://api.oss.idle.rhythmgamers.net/v1/beatmap/catalog';
/** How many of your newest plays are read: the tracker shows the 7K ones among them. */
const READ_PLAYS = 2000;
const CATALOG_MAX_AGE = 24 * 3600e3, CATALOG_RETRY = 3600e3, CATALOG_TIMEOUT = 20000;
const CACHE_DB = '7k-score-tracker', CACHE_STORE = 'kv', CATALOG_KEY = 'catalog-v2';

type Api = { me?: (options?: { ruleset?: string }) => Promise<{ character_id?: number, fatigue?: { minutes?: number } } | null | undefined> };
/** id → [title, difficulty, keys, length in seconds]; when it was fetched and last tried; maps it didn't have:
 *  id → [tries, when to try again]. */
type Catalog = { at: number, tried: number, maps: Record<number, [string, string, number, number, number]>, missing?: Record<number, [number, number]> };
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

// ---- the map catalogue ----

let catalog: Catalog | null = null;

const fetchCatalog = async (): Promise<Catalog> => {
	const maps: Catalog['maps'] = {};
	const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT) });
	if (!res.ok) throw new Error(`catalogue: ${res.status}`);
	const walk = (v: unknown): void => {
		if (!v || typeof v !== 'object') return;
		if (Array.isArray(v)) { v.forEach(walk); return; }
		const o = v as { title?: string, versions?: { id?: number, version?: string, keys?: number, total_length?: number, difficulty?: number }[] };
		if (Array.isArray(o.versions) && o.title) {
			for (const d of o.versions) if (d && d.id) maps[d.id] = [o.title, d.version ?? '', num(d.keys), num(d.total_length) / 1000, num(d.difficulty)];
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
	return catalog;
};

const infoOf = (cat: Catalog, id: number): MapInfo | undefined => {
	const m = cat.maps[id];
	return m ? { title: m[0], difficulty: m[1], keys: m[2], lengthSec: m[3], stars: num(m[4]) } : undefined;
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
		let me = null;
		try { me = await api?.me?.({ ruleset: 'mania7k' }); } catch { me = null; }
		characterId = num(me?.character_id);
	}
	let id = characterId;
	if (!id) {
		const guest = await rowsOf('SELECT id FROM character WHERE current = 1 LIMIT 1', []);
		id = num(guest?.[0]?.id);
	}
	if (!id) throw new TrackerError(TEXT.errors.noCharacter);
	playingAs = id;
	const rows = await rowsOf(
		`SELECT s.beatmapId AS beatmapId, s.playedAt AS playedAt, s.rate AS rate, s.mods AS mods, s.unranked AS unranked, x.gains AS gains
		 FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
		 WHERE s.characterId = ? ORDER BY s.playedAt DESC LIMIT ?`, [id, READ_PLAYS]);
	if (rows === null) throw new TrackerError(TEXT.errors.noDatabase);

	const parsed = rows.map((r) => ({ r, gains: parseGains(r.gains) }));
	// maps that can make the catalogue look out of date: ranked plays (unranked maps are never in it) that gave 7K
	// skills, or no XP at all (so their mode is unknown)
	const played = [...new Set(parsed.filter((p) => !num(p.r.unranked) && (!totalOf(p.gains) || ONLY_7K.some((sk) => num(p.gains[sk]) > 0))).map((p) => num(p.r.beatmapId)))];
	const cat = await mapCatalog(played);
	const out: Play[] = [];
	for (const { r, gains } of parsed) {
		const info = infoOf(cat, num(r.beatmapId));
		if (!is7kPlay(info, gains)) continue;
		out.push({ beatmapId: num(r.beatmapId), playedAt: num(r.playedAt), rate: num(r.rate) || 1, mods: String(r.mods ?? ''), gains, info, total: totalOf(gains) });
	}
	return out;
};

// ---- your playlist ----

/**
 * Saves maps (best first) into the add-on's own game playlist, named `name`, and returns its id. The first save makes
 * the playlist; later saves replace its maps. Only that playlist is ever written: the others are never touched.
 */
export const savePlaylist = async (id: number, name: string, maps: { beatmapId: number, rate: number }[]): Promise<number> => {
	if (!playingAs) throw new TrackerError(TEXT.errors.noCharacter);
	let playlist = id ? num(await gameDb.value('SELECT id FROM playlist WHERE id = ? AND characterId = ?', [id, playingAs])) : 0;
	if (!playlist) {
		const at = Date.now();
		await gameDb.run('INSERT INTO playlist (name, createdAt, characterId) VALUES (?, ?, ?)', [name, at, playingAs]);
		playlist = num(await gameDb.value('SELECT MAX(id) FROM playlist WHERE name = ? AND createdAt = ? AND characterId = ?', [name, at, playingAs]));
		if (!playlist) throw new Error('playlist: not created');
	}
	// one save: the name, then the maps replaced
	await gameDb.batch([
		{ sql: 'UPDATE playlist SET name = ? WHERE id = ?', params: [name, playlist] },
		{ sql: 'DELETE FROM playlist_entry WHERE playlistId = ?', params: [playlist] },
		...maps.map((m, i) => ({
			sql: "INSERT INTO playlist_entry (playlistId, beatmapId, rate, mods, position, repeat) VALUES (?, ?, ?, '', ?, 1)",
			params: [playlist, m.beatmapId, m.rate, i + 1],
		})),
	]);
	return playlist;
};

// ---- your strain, per play ----

const STRAIN_KEY = '7k-score-tracker:strain';
/** How many plays' strain is kept: the newest. */
const STRAIN_KEEP = 2000;
/** How many checks to wait for the game to count a new play's strain, when it hasn't changed yet. */
const STRAIN_WAITS = 2;
/** The strain when last checked, and each play's change per minute of its map (by when it was played). */
type StrainStore = { last?: [minutes: number, at: number], waits?: number, plays: Record<number, number> };
let strainStore: StrainStore | undefined;

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

/** A play's strain minutes per minute of its map, or undefined when it wasn't noted (played before this was added). */
export const strainOf = (playedAt: number): number | undefined => strainStoreOf().plays[playedAt];

/**
 * Notes how your newest play changed your strain: the strain now against the last check, over the map's length.
 * Called when a new play shows up (and when the tracker opens). True when a play was noted.
 */
export const noteStrain = async (api: Api | undefined): Promise<boolean> => {
	let me = null;
	try { me = await api?.me?.({ ruleset: 'mania7k' }); } catch { me = null; }
	const minutes = me?.fatigue?.minutes;
	const id = num(me?.character_id);
	if (typeof minutes !== 'number' || !id) return false;
	const s = strainStoreOf(), now = Date.now(), before = s.last;
	const newest = (await rowsOf('SELECT playedAt, beatmapId, rate FROM score WHERE characterId = ? ORDER BY playedAt DESC LIMIT 1', [id]))?.[0];
	const at = num(newest?.playedAt);
	let noted = false;
	if (newest && !(at in s.plays)) {
		// the game may not have counted the play's strain yet: when it hasn't changed since before the play, wait a check
		if (before && before[1] < at && before[0] === minutes && (s.waits ?? 0) < STRAIN_WAITS) {
			s.waits = (s.waits ?? 0) + 1;
			saveStrain(s);
			return false;
		}
		const info = infoOf(await mapCatalog([]), num(newest.beatmapId));
		const lengthMin = info && info.lengthSec > 0 ? info.lengthSec / (num(newest.rate) || 1) / 60 : 0;
		// only with a check from during the play (or just before it): an older one would count the rest before it too
		if (before && lengthMin && before[1] < at && at - before[1] <= lengthMin * 60e3 + 60e3) {
			s.plays[at] = Math.round(strainPerMinute(before[0], minutes, lengthMin) * 100) / 100;
			noted = true;
		}
	}
	s.last = [minutes, now];
	s.waits = 0;
	saveStrain(s);
	return noted;
};
