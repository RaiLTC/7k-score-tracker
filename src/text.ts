// Every word players see, in one place (Google developer style: sentence case, plain words).

export const TEXT = {
	name: '7K Score Tracker',
	close: 'Close',
	refresh: 'Refresh',
	views: 'View',
	plays: 'Recent plays',
	best: 'Most effective maps',
	bestNote: 'by XP per minute',
	loading: 'Loading…',
	noPlays: 'No 7K plays yet.',
	noBest: 'No 7K plays with XP yet.',
	noXp: 'No XP',
	average: (n: number) => `Average of ${n} plays`,
	map: (id: number) => `Map ${id}`,
	cols: {
		when: 'When', map: 'Map', rate: 'Rate', xp: 'XP', skills: 'Skills',
		number: '#', plays: 'Plays', perMinute: 'XP / min',
	},
	skills: {
		accuracy: 'Accuracy', speed: 'Speed', stamina: 'Stamina', jacks: 'Jacks', independence: 'Independence',
		ln: 'LN', technical: 'Technical', focus: 'Focus', sv: 'SV', memory: 'Memory',
	} as Record<string, string>,
	errors: {
		noCharacter: 'Your character couldn’t be read. Sign in, then refresh.',
		noDatabase: 'The game hasn’t opened its database yet. Try again in a moment.',
	},
};
