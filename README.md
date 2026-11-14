# 7K Score Tracker

An [oss!idle](https://oss.idle.rhythmgamers.net) add-on for 7K: your recent plays, the XP each one gave per skill, and the maps that give you the most XP per minute.

Press **Alt+Shift+S** in game. Esc closes it.

- **Recent plays:** your latest 7K plays: when, the map, rate and mods, XP, and which skills it trained.
- **Most effective maps:** every 7K map you've played, ranked by XP per minute at the rate you played it.
- **Click any play or map** to see its XP per skill.

## What it reads, and from where

- **Your plays:** the game's own database on your computer. Never the server, so it works for guests too.
- **Map names, key counts and lengths:** the game's map catalogue (`api.oss.idle.rhythmgamers.net`). It's kept on your computer and downloaded again only once a day, or when you've played a 7K map it doesn't know yet (at most once an hour).
- **Who you are:** the game's API, asked once per game session.

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
| `src/view.ts` | The lists as HTML |
| `src/styles.css` | Styles, in the window's shadow root |
| `src/text.ts` | Every word players see |

Releases: `npm run release`, which tags the version and pushes it; oss!idle builds the tag. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[AGPL-3.0](LICENSE)
