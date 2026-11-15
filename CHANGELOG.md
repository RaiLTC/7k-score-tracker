# Changelog

All notable changes to 7K Score Tracker. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.32] - 2026-11-15

### Added

- Search: != means not, like skill!=accuracy (hides maps that give Accuracy the most XP) or star!=5
- Select a skill in the Skills box to hide the maps that give it the most XP from Most effective maps, the recent list and the playlist

## [0.1.31] - 2026-11-15

### Changed

- Search: the star rating tag is star, stars or star-rating

## [0.1.30] - 2026-11-15

### Added

- Search bar under the header: map name or difficulty, plus tags like length>1m30, length<90, skill:stamina and star>=5. Works in every tab

## [0.1.29] - 2026-11-15

### Added

- Leave out old plays: when it's on, Most effective maps ignores plays older than the time you set (off by default, 12 hours)

## [0.1.28] - 2026-11-15

### Added

- Save as playlist: saves the recent list's maps, at their rates, to a 7K playlist in the game. Saving again replaces its maps; no other playlist is touched
- Plays averaged: how many of your latest plays per map the XP rates use. 1 by default for Most effective maps and Skills, all plays (0) for the recent list

## [0.1.27] - 2026-11-15

### Fixed

- Settings number boxes: typing 10 gave 0, because each digit selected the number again. The number is now selected only when you click into the box

## [0.1.26] - 2026-11-15

### Fixed

- Settings number boxes: Backspace and Delete didn't work in game, so a new number was added to the old one. Clicking a box now selects its number, and Enter saves it

## [0.1.25] - 2026-11-15

### Changed

- Settings: shorter, plainer wording
- Button style now applies to the tabs and switches too

## [0.1.24] - 2026-11-15

### Changed

- Lighter on resources: Recent plays shows 50 plays at a time and adds the next 50 as you scroll down, and only the tab you're looking at is drawn

## [0.1.23] - 2026-11-15

### Changed

- Checks for new plays every 10 seconds instead of every 2, while the window is open

## [0.1.22] - 2026-11-15

### Fixed

- A map opened by itself in one list when it was open in the other and a new play came in
- Show all plays showed in Recent plays even with no map picked

## [0.1.21] - 2026-11-15

### Added

- Recent plays: plays older than your recent time are grayed out, and XP is green or red against your play before on the map
- Show a map's recent plays on their own: open a row and select Show its recent plays, or select a map's name in the Skills tab. Show all plays goes back

### Changed

- A fresher look: darker background with a slight gradient, card borders, bolder titles with an accent line under them

### Fixed

- Rows in the recent section of Most effective maps couldn't be opened

## [0.1.20] - 2026-11-15

### Changed

- Top skills: the skill names show in their colours (gray on grayed-out maps)
- Stamina is green and Focus light gray, so they're easier to tell from Speed

## [0.1.19] - 2026-11-15

### Added

- Most effective maps: a Last hour section above the full list, ranked from your plays in that time only
- Maps you haven't played in that time are grayed out in the full list
- A map's latest XP is green when it gave more than your play before, red when less
- Settings: show or hide the recent section, how long counts as recent (minutes or hours, 1 hour by default), and how many maps each list shows (10 and 25 by default)

### Changed

- The window is taller
- The trend arrows are green and red

## [0.1.18] - 2026-11-15

### Fixed

- 7K plays that saved no XP, on maps new to the tracker, didn't show up (often after switching from 4K). The map list is now fetched right away when you play a map it doesn't know, then again 1 and 5 minutes later; a map still missing after that isn't asked about again

## [0.1.17] - 2026-11-15

### Added

- Recent plays: an XP/h, XP/m or XP/s column for each play, with the same switch as the other tabs

## [0.1.16] - 2026-11-14

### Changed

- Skills tab: each skill's best map shows its difficulty after the name

## [0.1.15] - 2026-11-14

### Added

- Updates itself while open: new plays and their XP show up within 2 seconds, and open rows stay open
- An arrow next to a map's XP when it gave clearly less (↓) or more (↑) than your play before

### Fixed

- A play saved without XP no longer shows as 0 XP or No XP on its map, and doesn't lower its averages

## [0.1.14] - 2026-11-14

### Changed

- Skills tab: the difficulty sits after the map name, and the columns use the full width

## [0.1.13] - 2026-11-14

### Added

- Skills tab: for each skill, the 5 maps that gave it the most XP (click a skill to open it)
- Solid buttons in your accent colour, now the default button style

### Changed

- Numbers sit centred in their columns, and columns are closer together
- Mods show under the map name
- Your lists stay up while Refresh loads

## [0.1.12] - 2026-11-14

### Added

- Drag the window by its header

### Fixed

- The game's options menu and chat open again: the window only holds keys and focus while it's open

## [0.1.11] - 2026-11-14

### Fixed

- Total XP and the breakdown show your latest play on the map, not the sum or average of every play

## [0.1.10] - 2026-11-14

### Changed

- Stats sit on the right, under their headings
- Top skills: up to 2, in thinner rows
- Row highlight reaches the card edges, and an open row is highlighted with its breakdown
- Breakdown lines up with the columns above it

## [0.1.09] - 2026-11-14

### Fixed

- Hovering a row underlines the map name instead of filling the row
- Even row heights and spacing

## [0.1.08] - 2026-11-14

### Fixed

- Rows fit all 3 top skills

## [0.1.07] - 2026-11-14

### Changed

- Top skills: stacked, and only skills with 15% of the XP or more (up to 3)

## [0.1.06] - 2026-11-14

### Changed

- Top 3 skills show as names only

## [0.1.05] - 2026-11-14

- No changes (the fix missed this build)

## [0.1.04] - 2026-11-14

### Added

- Skills box with each skill's colour, above Most effective maps
- Total XP column, and XP per hour, minute or second
- Settings: accent colour, button style, and the Skills column as a colour bar or the top 3 skills

### Changed

- Rate and plays show as plain numbers

## [0.1.03] - 2026-11-14

### Added

- Settings (the gear): change the shortcut that opens the window
- Opening a play or a map shows its total XP above the XP per skill

### Changed

- Rates and play counts show with ×
- Neutral accent colour

## [0.1.02] - 2026-11-14

### Changed

- Opens with Alt+Shift+S

## [0.1.01] - 2026-11-14

### Changed

- Renamed to 7K Score Tracker

## [0.1] - 2026-11-14

### Added

- Recent plays: your latest 7K plays with their rate, mods, XP and the skills they trained
- Most effective maps: every 7K map you've played, ranked by XP per minute
- Click a play or a map for its XP per skill
- The map catalogue is kept on your computer and downloaded again only when needed
