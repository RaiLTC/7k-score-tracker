// Shared: each map's base XP from everyone's plays (the 7K Shared server, a Cloudflare Worker: 7k-shared-server).
// - Players who agree send their new plays' base XP (the XP with their bonuses taken back out, rules/base.js) in
//   batches, every 5 minutes, whatever is waiting then. A batch that can't be sent waits for the next time; nothing
//   from before they agreed (or from while sharing was off) is ever sent.
// - Everyone, sharing or not, gets the map table, kept on this computer and fetched again once it's 5 minutes old
//   (or right after a batch is sent, or on Refresh).
// Kept on this computer: a random player id (made here; it's all the server knows about a player), how far sending
// has got, and the last table.

import { buildMeta, gameHost } from '@oss-idle/addon-sdk';
import { type MapInfo, type Play, num } from '../rules/logic.js';
import { basePlays, levelHistory, mapInfos } from './data.js';

export const SHARED_URL = 'https://7k-shared.7k-shared-database.workers.dev';

const ID_KEY = '7k-score-tracker:shared-id', SENT_KEY = '7k-score-tracker:shared-sent', TABLE_KEY = '7k-score-tracker:shared-table';
/** What's waiting is sent this often (a batch that failed waits for the next time too). */
export const SEND_EVERY = 5 * 60e3;
/** The table kept on this computer is fetched again once it's this old (and after a batch is sent). */
const TABLE_AGE = 5 * 60e3;

/** A map and rate's shared base XP, as the server sends it. */
export type SharedMap = { map: number, rate: number, players: number, plays: number, perMinute: number, base: Record<string, number> };
/** `sharing`: false while the server's off switch is on (then nothing is sent). */
export type SharedTable = { game: string, made: string, fetched: number, sharing?: boolean, maps: SharedMap[] };
/** How far sending has got: plays from `since` (agreeing) on, up to `last`, were sent; `note`: sent, not shown yet;
 *  `tryAt`: when the last batch was tried (the next goes SEND_EVERY later). */
type Sent = { since: number, last: number, count: number, note: number, tryAt: number };

const read = <T>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* this session only */ } };

/** The game's version, which the server keeps plays apart by (a patch starts fresh). */
export const gameVersion = (): string => gameHost()?.version || buildMeta().gameVersion || '';

/** This computer's random player id, made the first time it's needed. */
const playerId = (): string => {
	let id = read<string>(ID_KEY);
	if (!id) { id = crypto.randomUUID(); write(ID_KEY, id); }
	return id;
};
let sent: Sent | undefined;
const sentState = (): Sent => (sent ??= read<Sent>(SENT_KEY) ?? { since: 0, last: 0, count: 0, note: 0, tryAt: 0 });
const saveSent = () => write(SENT_KEY, sentState());

/** How many plays this computer has sent. */
export const sentCount = (): number => sentState().count;

/** Sharing starts, or starts again (the player agreed, or turned it back on): only plays from now on are sent, never
 *  ones from before, or from while it was off. */
export const startSharing = (): void => {
	const s = sentState(), now = Date.now();
	s.since ||= now;
	s.last = Math.max(s.last, now);
	saveSent();
};

/** Plays sent but not shown in a note yet; taken (so it shows once). */
export const takeNote = (): number => {
	const s = sentState(), n = s.note;
	if (n) { s.note = 0; saveSent(); }
	return n;
};

/** A skill's level when it was played (the mark in effect then; the first mark counts for earlier plays). */
const levelAt = (skill: string, at: number): number => {
	const marks = levelHistory()[skill] ?? [];
	let level = num(marks[0]?.[1]);
	for (const [from, lv] of marks) if (from <= at) level = num(lv);
	return level;
};

/** The plays waiting to be sent: base XP worked out, since sharing (last) started, not sent yet. @param plays newest first */
const waitingIn = (plays: Play[]) => {
	const s = sentState();
	if (!s.since) return [];
	return basePlays(plays).flatMap((b) => ('base' in b && b.play.playedAt > s.last && b.play.info && b.play.info.lengthSec > 0 ? [{ play: b.play, base: b.base }] : []));
};
/** How many plays are waiting to be sent. @param plays newest first */
export const waitingCount = (plays: Play[]): number => waitingIn(plays).length;
/** When the next batch goes. */
export const nextSendAt = (): number => sentState().tryAt + SEND_EVERY;

/**
 * Sends the plays waiting, when the next batch is due (every 5 minutes); how many were sent.
 * @param plays the newest plays, newest first (as read)
 */
export const sendBatch = async (plays: Play[]): Promise<number> => {
	const s = sentState(), now = Date.now();
	if (!s.since || now < nextSendAt() || sharedTable()?.sharing === false) return 0;
	const game = gameVersion();
	if (!game) return 0;
	// due: the next check is 5 minutes from now, whether anything goes or not
	s.tryAt = now;
	saveSent();
	const waiting = waitingIn(plays);
	if (!waiting.length) return 0;
	const batch = waiting.slice(-200).map(({ play: p, base }) => ({
		map: p.beatmapId, rate: p.rate, mods: p.mods, acc: num(p.acc), misses: num(p.misses), len: p.info!.lengthSec, base, at: p.playedAt,
		levels: Object.fromEntries(Object.keys(base).map((sk) => [sk, levelAt(sk, p.playedAt)])),
	}));
	try {
		const res = await fetch(`${SHARED_URL}/v1/plays`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player: playerId(), game, plays: batch }) });
		// the server's off switch: nothing more is sent until the table says sharing is back
		if (res.status === 503) { const t = sharedTable(); if (t) write(TABLE_KEY, { ...t, sharing: false, fetched: 0 }); throw new Error('paused'); }
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		s.last = Math.max(...batch.map((b) => b.at));
		s.count += batch.length;
		s.note += batch.length;
		saveSent();
		return batch.length;
	} catch {
		return 0;
	}
};

/** Deletes every play this computer shared, on the server; sharing stops, and a new id is made if it starts again. */
export const deleteShared = async (): Promise<boolean> => {
	const id = read<string>(ID_KEY);
	if (id) {
		const res = await fetch(`${SHARED_URL}/v1/players/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
		if (!res?.ok) return false;
	}
	try { localStorage.removeItem(ID_KEY); localStorage.removeItem(SENT_KEY); } catch { /* */ }
	sent = undefined;
	return true;
};

/** The map table kept on this computer (null before the first fetch). */
export const sharedTable = (): SharedTable | null => read<SharedTable>(TABLE_KEY);

/** The map table, fetched again once it's an hour old (or when `force`); the kept one when the server can't be reached. */
export const fetchTable = async (force = false): Promise<SharedTable | null> => {
	const kept = sharedTable(), game = gameVersion();
	if (!force && kept && kept.game === game && Date.now() - kept.fetched < TABLE_AGE) return kept;
	try {
		const res = await fetch(`${SHARED_URL}/v1/maps${game ? `?game=${encodeURIComponent(game)}` : ''}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json() as Omit<SharedTable, 'fetched'>;
		const table = { ...body, fetched: Date.now() };
		write(TABLE_KEY, table);
		return table;
	} catch {
		return kept;
	}
};

/** The pool's numbers: every play shared, and how many arrived in the past hour. */
export type SharedStats = { plays: number, players: number, lastHour: number };
let stats: { at: number, value: SharedStats | null } = { at: 0, value: null };
/** The pool's numbers, asked for again at most every 2 minutes (the last ones when the server can't be reached). */
export const fetchStats = async (): Promise<SharedStats | null> => {
	if (Date.now() - stats.at < 2 * 60e3) return stats.value;
	stats.at = Date.now();
	try {
		const res = await fetch(`${SHARED_URL}/v1/health`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json() as Partial<SharedStats>;
		stats.value = { plays: num(body.plays), players: num(body.players), lastHour: num(body.lastHour) };
	} catch { /* the last ones */ }
	return stats.value;
};

/** The maps' names and lengths, from the catalogue. */
export const sharedInfos = (table: SharedTable): Promise<Record<number, MapInfo | undefined>> => mapInfos(table.maps.map((m) => m.map));
