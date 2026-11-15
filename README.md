# 7K Score Tracker

An [oss!idle](https://oss.idle.rhythmgamers.net) add-on for 7K: your recent plays, the XP each one gave per skill, and the maps that give you the most XP per minute.

Press **Alt+Shift+S** in game, or the shortcut you set in Settings (the gear), where you can also pick the accent colour, the button style and how skills show. Esc closes it.

- **Recent plays:** your latest 7K plays: when, the map, rate and mods, XP, XP per hour, minute or second, strain, and which skills it trained (a bar per skill).
- **Most effective maps:** your top 25 7K maps, ranked by XP per minute at the rate you played them, under your top 10 from the last hour. Maps you haven't played in that hour are grayed out. The numbers and the hour can be changed in Settings.
- **Save as playlist:** saves your best maps from the last hour, at their rates, to a playlist in the game.
- **Skills:** for each skill, the 5 maps that gave it the most XP. Click a skill to open it.
- **Search** by map name or difficulty, with tags: `length>1m30` (or seconds, `length<90`), `skill:stamina`, `star>=5`.
- **Strain:** the strain bar after each play, in its zone's colour as in Queue Helper, with the game's arrows (› straining, ‹ resting). In Settings it can show the strain minutes the play added (+) or rested (−) per minute of the map instead. For a map, its latest play. The game keeps no strain per play, so the tracker notes it as plays come in (it keeps checking for new plays while closed); plays from before show –.
- **XP per time is coloured** from green (the list's best) through yellow and orange to red (its worst).
- **Click any play or map** to see its total XP and the XP per skill, and to show only its recent plays.
- **Updates itself** while it's open: a new play, and its XP, show up within 10 seconds. A map's latest XP is green when it gave more than your play before and red when less, with an arrow when the change is 5% or more.

## What it reads, and from where

- **Your plays:** the game's own database on your computer. Never the server, so it works for guests too.
- **Map names, key counts and lengths:** the game's map catalogue (`api.oss.idle.rhythmgamers.net`). It's kept on your computer and downloaded again once a day, and right away when you play a map it doesn't know yet (then 1 and 5 minutes later; a map still missing after that isn't asked about again).
- **Who you are:** the game's API, asked once per game session.
- **Your strain:** the game's API, asked once when a new play shows up. What it noted is kept on your computer.

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
| `src/data.ts` | Reading plays, and the cached map catalogue |
| `src/logic.js` | The rules (which plays are 7K, ranking maps), tested in `test/` |
| `src/settings.ts` | What players can set (the shortcut, the last view) |
| `src/view.ts` | The lists as HTML |
| `src/styles.css` | Styles, in the window's shadow root |
| `src/text.ts` | Every word players see |

Releases: `npm run release`, which tags the version and pushes it; oss!idle builds the tag. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[AGPL-3.0](LICENSE)
