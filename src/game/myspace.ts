// MySpace Mode's news: which map is your #1 (Effective Maps), since when, and the one before it. Kept on this
// computer, written only when the #1 changes.

const THRONE_KEY = '7k-score-tracker:ms-throne';

/** The #1 map: its id and song, since when it's #1; the song it took #1 from, and when. */
export type Throne = { id: number, title: string, since: number, prev?: string, changedAt?: number };

let throne: Throne | null | undefined;

/** Notes the #1 map as it is now, and returns its reign (a new #1 starts one, remembering the one before). */
export const noteThrone = (id: number, title: string, now: number): Throne => {
	if (throne === undefined) {
		try { throne = JSON.parse(localStorage.getItem(THRONE_KEY) ?? 'null') as Throne | null; } catch { throne = null; }
	}
	if (throne && throne.id === id) return throne;
	throne = { id, title, since: now, ...(throne ? { prev: throne.title, changedAt: now } : {}) };
	try { localStorage.setItem(THRONE_KEY, JSON.stringify(throne)); } catch { /* memory only */ }
	return throne;
};
