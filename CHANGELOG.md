# Changelog

All notable changes to 7K Score Tracker. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
