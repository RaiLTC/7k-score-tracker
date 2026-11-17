// The maps ADHD Mode's accuracy surprise has played for: each only once, ever (kept on this computer).

const KEY = '7k-score-tracker:accuracy-surprise';
let maps: Set<number> | undefined;

/** The maps the surprise has played for. */
export const surprised = (): Set<number> => {
	if (maps) return maps;
	try {
		const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
		maps = new Set(Array.isArray(list) ? list.filter((x): x is number => Number.isInteger(x)) : []);
	} catch { maps = new Set(); }
	return maps;
};

/** The surprise played for a map: never again for it. */
export const noteSurprise = (beatmapId: number): void => {
	surprised().add(beatmapId);
	try { localStorage.setItem(KEY, JSON.stringify([...surprised()])); } catch { /* kept for this session only */ }
};
