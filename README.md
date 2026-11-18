# 7K Score Tracker

An [oss!idle](https://oss.idle.rhythmgamers.net) add-on for 7K: your recent plays, the XP each one gave per skill, and the maps that give you the most XP per minute.

Press **Alt+Shift+S** in game, or the shortcut you set in Settings (the gear), where you can also pick the accent colour, the button style and how skills and strain show. Esc closes it. The button next to the gear shows the changelog.

- **Recent:** your latest 7K plays: when, the map, rate and mods, XP, XP per hour, minute or second, strain, and which skills it trained (a bar per skill).
- **Effective Maps:** your top 25 7K maps, ranked by XP per minute at the rate you played them, under your top 10 from the last hour. Maps you haven't played in that hour are grayed out. The numbers and the hour can be changed in Settings.
- **Save as playlist:** saves your best maps from the last hour, at their rates, to a playlist in the game.
- **Skills:** for each skill, the 5 maps that gave it the most XP. Click a skill to open it.
- **Strain tab:** press Suggest. **Max strain** lists your 5 best maps by XP per minute that warm you up the most, and 5 that cool you down the most. **To Peak** works out the plays that take you back to Peak, best XP per minute first with mindblock counted (a map mindblock doesn't cut can repeat). To Peak is a rough estimate: the game can't simulate 7K, so a map can strain you differently once you level up. Both use your plays from the Strain time in Settings (3 hours by default). Save either as a playlist.
- **Search** by map name or difficulty, with tags: `ln>1m30` (or seconds, `ln<90`), `sk:stamina`, `sr>=5`. The **?** in the search bar lists them all.
- **Strain:** the strain bar after each play, in its zone's colour as in Queue Helper, with the game's arrows (› straining, ‹ resting). In Settings it can show the strain minutes the play added (+) or rested (−) per minute of the map instead. The recent list and Effective Maps show only the arrows, for each map's latest play. The game keeps no strain per play, so the tracker notes it as plays come in (it keeps checking for new plays while closed); plays from before show –.
- **XP per time is coloured** from green (the list's best) through yellow and orange to red (its worst).
- **Click any play or map** to see its total XP and the XP per skill, and to show only its recent plays.
- **Debug** (the bug button): your last 100 API calls and your newest 50 plays with everything the game keeps for them, to copy into a bug report.
- **Updates itself** while it's open: a new play, and its XP, show up within 10 seconds. A map's latest XP is green when it gave more than your play before and red when less, with an arrow when the change is 5% or more.

## What it reads, and from where

- **Your plays:** the game's own database on your computer. Never the server, so it works for guests too.
- **Map names, key counts and lengths:** the game's map catalogue (`api.oss.idle.rhythmgamers.net`). It's kept on your computer and downloaded again once a day, and right away when you play a map it doesn't know yet (then 1 and 5 minutes later; a map still missing after that isn't asked about again).
- **Who you are:** the game's API, asked once per game session.
- **Your strain:** the game's API, asked once when a new play shows up. What it noted, and the last 100 answers (for Debug), are kept on your computer.

Nothing is sent anywhere else.

## Install

In game: Options → Add-ons → Browse, and search for 7K Score Tracker. Or build it yourself (below) and paste `dist/7k-score-tracker.js` into Options → Add-ons → Manage.

## Developing

Built with the official [oss!idle Addon SDK](https://github.com/oss-idle/addon-sdk), following the [add-on guide](https://oss.idle.rhythmgamers.net/web/docs/addons).

```sh
npm install
npm run check   # typecheck, lint, test, build
```

| Path | What's in it |
| --- | --- |
| `src/index.ts` | What oss!idle calls: `mount`, `unmount` |
| `src/Tracker.ts` | The add-on: window, shortcut, loading |
| `src/settings.ts` | What players can set (the shortcut, the last view) |
| `src/rules/` | The rules, tested in `test/`: which plays are 7K and ranking maps (`logic.js`), strain per play (`strain.js`), the bar, mindblock and the plays to Peak (`peak.js`), outdated plays (`outdated.js`), base XP (`base.js`) |
| `src/game/data.ts` | Reading plays, the game's API, the cached map catalogue, and what's kept on your computer |
| `src/game/surprise.ts` | The maps ADHD Mode's accuracy surprise has played for |
| `src/game/shared.ts` | Shared: sending plays' base XP in batches, and the map table, from the Shared server (7k-shared-server, a Cloudflare Worker) |
| `src/ui/view.ts` | The lists as HTML |
| `src/ui/text.ts` | Every word players see |
| `src/ui/genz.ts` | ADHD Mode: its animations and sounds |
| `src/ui/sound-clips.ts` | ADHD Mode's recorded party horn (CC0, from Freesound) |
| `src/ui/styles.css` | Styles, in the window's shadow root |
| `src/ui/changelog.js` | CHANGELOG.md for the Changelog view, made by `npm run changelog` (also run by `build` and `check`) |

Releases: `npm run release`, which tags the version and pushes it; oss!idle builds the tag. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[AGPL-3.0](LICENSE)
