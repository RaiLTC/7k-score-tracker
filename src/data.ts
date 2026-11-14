// Where the tracker's data comes from, as little from the server as possible (the game's developers asked add-ons
// to store what they fetch rather than fetching it again):
// - your plays: the game's own database on this computer (score and score_xp), never the server;
// - map names, key counts and lengths: the game's map catalogue, kept on this computer (IndexedDB) and fetched again
//   only once it's a day old, or when you've played a 7K map it doesn't know yet (at most once an hour);
// - who you are: the game's API, asked once per game session.

import { gameDb, type SqlValue } from '@oss-idle/addon-sdk';
import { type MapInfo, type Play, is7kPlay, num, ONLY_7K, parseGains, totalOf } from './logic.js';
import { TEXT } from './text.js';

const CATALOG_URL = 'https://api.oss.idle.rhythmgamers.net/v1/beatmap/catalog';
/** How many of your newest plays are read: the tracker shows the 7K ones among them. */
const READ_PLAYS = 2000;
const CATALOG_MAX_AGE = 24 * 3600e3, CATALOG_RETRY = 3600e3, CATALOG_TIMEOUT = 20000;
const CACHE_DB = '7k-score-tracker', CACHE_STORE = 'kv', CATALOG_KEY = 'catalog';

type Api = { me?: (options?: { ruleset?: string }) => Promise<{ character_id?: number } | null | undefined> };
/** id → [title, difficulty, keys, length in seconds]; when it was fetched, and last tried. */
type Catalog = { at: number, tried: number, maps: Record<number, [string, string, number, number]> };

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
		const o = v as { title?: string, versions?: { id?: number, version?: string, keys?: number, total_length?: number }[] };
		if (Array.isArray(o.versions) && o.title) {
			for (const d of o.versions) if (d && d.id) maps[d.id] = [o.title, d.version ?? '', num(d.keys), num(d.total_length) / 1000];
		}
		for (const [k, child] of Object.entries(o)) if (k !== 'versions') walk(child);
	};
	walk(await res.json());
	const now = Date.now();
	return { at: now, tried: now, maps };
};

/** The catalogue: from memory, else this computer, fetched again only when it's old or misses a played 7K map. */
const mapCatalog = async (played7k: number[]): Promise<Catalog> => {
	catalog ??= (await cacheGet<Catalog>(CATALOG_KEY)) ?? { at: 0, tried: 0, maps: {} };
	const now = Date.now();
	const old = now - catalog.at > CATALOG_MAX_AGE;
	const missing = played7k.some((id) => !catalog!.maps[id]) && now - catalog.tried > CATALOG_RETRY;
	if (old || missing) {
		try {
			catalog = await fetchCatalog();
		} catch {
			// unreachable: keep what's stored, and don't ask again for an hour
			catalog = { ...catalog, tried: now };
		}
		void cacheSet(CATALOG_KEY, catalog);
	}
	return catalog;
};

const infoOf = (cat: Catalog, id: number): MapInfo | undefined => {
	const m = cat.maps[id];
	return m ? { title: m[0], difficulty: m[1], keys: m[2], lengthSec: m[3] } : undefined;
};

// ---- your plays ----

let characterId = 0;

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
	const rows = await rowsOf(
		`SELECT s.beatmapId AS beatmapId, s.playedAt AS playedAt, s.rate AS rate, s.mods AS mods, x.gains AS gains
		 FROM score s LEFT JOIN score_xp x ON x.scoreId = s.id
		 WHERE s.characterId = ? ORDER BY s.playedAt DESC LIMIT ?`, [id, READ_PLAYS]);
	if (rows === null) throw new TrackerError(TEXT.errors.noDatabase);

	const parsed = rows.map((r) => ({ r, gains: parseGains(r.gains) }));
	// only a 7K-looking play's map can make the catalogue look out of date (unranked maps are never in it)
	const played7k = [...new Set(parsed.filter((p) => ONLY_7K.some((sk) => num(p.gains[sk]) > 0)).map((p) => num(p.r.beatmapId)))];
	const cat = await mapCatalog(played7k);
	const out: Play[] = [];
	for (const { r, gains } of parsed) {
		const info = infoOf(cat, num(r.beatmapId));
		if (!is7kPlay(info, gains)) continue;
		out.push({ beatmapId: num(r.beatmapId), playedAt: num(r.playedAt), rate: num(r.rate) || 1, mods: String(r.mods ?? ''), gains, info, total: totalOf(gains) });
	}
	return out;
};
