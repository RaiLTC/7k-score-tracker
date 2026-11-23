// Shared: each map's base XP from everyone's plays (the 7K Shared server, a Cloudflare Worker: 7k-shared-server).
// - Players who agree send their new plays' base XP (the XP with their bonuses taken back out, rules/base.js) in
//   batches, every 10 minutes, whatever is waiting then. A batch that can't be sent waits for the next time; nothing
//   from before they agreed (or from while sharing was off) is ever sent.
// - Everyone, sharing or not, gets the map table, kept on this computer and fetched again every 10 minutes, a minute after everyone's batch (at :00, :10, :20…)
//   (or right after a batch is sent, or on Refresh).
// Kept on this computer: a random player id (made here; it's all the server knows about a player), how far sending
// has got, and the last table.

import { buildMeta, gameHost } from '@oss-idle/addon-sdk';
import { type MapInfo, type Play, num } from '../rules/logic.js';
import { basePlays, levelHistory, mapInfos } from './data.js';

export const SHARED_URL = 'https://7k-shared.7k-shared-database.workers.dev';

const ID_KEY = '7k-score-tracker:shared-id', SENT_KEY = '7k-score-tracker:shared-sent', TABLE_KEY = '7k-score-tracker:shared-table';
/** What's waiting is sent this often (a batch that failed waits for the next time too). */
export const SEND_EVERY = 10 * 60e3;
/** The table kept on this computer is fetched again once it's this old (and after a batch is sent). */
const TABLE_AGE = 10 * 60e3;
/** When the table was last fetched for: :00, :10, :20…, a minute after everyone's batch (the server saves it in between). */
const lastSaved = (now: number) => Math.floor(now / TABLE_AGE) * TABLE_AGE;
/** The fetch's countdown: a minute from the batch going out (:09, :19, :29…) to the fetch; null outside that minute. */
export const fetchIn = (now: number): number | null => {
	const left = TABLE_AGE - (now % TABLE_AGE);
	return left <= FETCH_AFTER ? left : null;
};
/** How long after the batch the table is fetched. */
export const FETCH_AFTER = 60e3;
/** True when the table is due a fetch (none kept, another game version, or not fetched since the last :x0). */
export const tableDue = (): boolean => {
	const kept = sharedTable();
	// after a failed fetch, not again for 30 seconds
	if (Date.now() - failedAt < 30e3) return false;
	return !kept || kept.game !== gameVersion() || kept.fetched < lastSaved(Date.now());
};
let failedAt = 0;

/** A map and rate's shared base XP, as the server sends it. */
/** `mapPlayers`: the map's players over all its rates, each counted once. */
export type SharedMap = { map: number, rate: number, players: number, plays: number, perMinute: number, base: Record<string, number>, mapPlayers?: number };
/** `sharing`: false while the server's off switch is on (then nothing is sent). */
export type SharedTable = { game: string, made: string, fetched: number, sharing?: boolean, maps: SharedMap[] };
/** How far sending has got: plays from `since` (agreeing) on, up to `last`, were sent; `note`: sent, not shown yet;
 *  `tryAt`: when the last batch was tried (the next goes at the clock's next send time after it). */
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
/** How long before the server saves its tables (every 10 minutes on the clock) everyone sends: :09, :19, :29… */
const SEND_LEAD = 60e3;
/** When the next batch goes: the clock's first send time after the last try, the same for everyone. */
export const nextSendAt = (): number => (Math.floor((sentState().tryAt + SEND_LEAD) / SEND_EVERY) + 1) * SEND_EVERY - SEND_LEAD;

/**
 * Sends the plays waiting, when the next batch is due (every 10 minutes); how many were sent.
 * @param plays the newest plays, newest first (as read)
 */
export const sendBatch = async (plays: Play[]): Promise<number> => {
	const s = sentState(), now = Date.now();
	if (!s.since || now < nextSendAt() || sharedTable()?.sharing === false) return 0;
	const game = gameVersion();
	if (!game) return 0;
	// due: the next check is at the next send time, whether anything goes or not
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

/** The map table kept on this computer (null before the first fetch). */
export const sharedTable = (): SharedTable | null => read<SharedTable>(TABLE_KEY);

/** The map table (never from the browser's own cache: freshness is decided here), fetched again once it's an hour old (or when `force`); the kept one when the server can't be reached. */
export const fetchTable = async (force = false): Promise<SharedTable | null> => {
	const kept = sharedTable(), game = gameVersion();
	// fetched again at :00, :10, :20…: a minute after the batches sent at :09, :19, :29… (the server saved them in between)
	if (!force && kept && kept.game === game && kept.fetched >= lastSaved(Date.now())) return kept;
	try {
		// with the kept table's time: when it hasn't changed, nothing is downloaded
		const since = kept && kept.game === game ? kept.made : '';
		const res = await fetch(`${SHARED_URL}/v1/maps?game=${encodeURIComponent(game ?? '')}${since ? `&since=${encodeURIComponent(since)}` : ''}`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json() as Omit<SharedTable, 'fetched'> & { same?: boolean };
		if (body.same && kept) {
			const same = { ...kept, sharing: body.sharing, fetched: Date.now() };
			write(TABLE_KEY, same);
			return same;
		}
		const table = { ...body, fetched: Date.now() };
		write(TABLE_KEY, table);
		return table;
	} catch {
		failedAt = Date.now();
		return kept;
	}
};

/** The pool's numbers: every play shared, the players, and how many arrived in the past hour and 10 minutes. */
/** `now`: the players whose plays arrived in the past 10 minutes (undefined from a server that doesn't count them). */
export type SharedStats = { plays: number, players: number, now?: number, lastHour: number, last10: number };
let stats: { at: number, value: SharedStats | null } = { at: 0, value: null };
/** The pool's numbers, asked for again at most every 30 seconds (the last ones when the server can't be reached). */
export const fetchStats = async (): Promise<SharedStats | null> => {
	if (Date.now() - stats.at < 25e3) return stats.value;
	stats.at = Date.now();
	try {
		const res = await fetch(`${SHARED_URL}/v1/health`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json() as Partial<SharedStats>;
		stats.value = { plays: num(body.plays), players: num(body.players), now: body.now === undefined ? undefined : num(body.now), lastHour: num(body.lastHour), last10: num(body.last10) };
	} catch { /* the last ones */ }
	return stats.value;
};

/** The maps' names and lengths, from the catalogue. */
export const sharedInfos = (table: SharedTable): Promise<Record<number, MapInfo | undefined>> => mapInfos(table.maps.map((m) => m.map));
