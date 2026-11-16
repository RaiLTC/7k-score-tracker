// Copies CHANGELOG.md into src/ui/changelog.js, for the add-on's Changelog view (the build can't read .md files).
// Run by `npm run build` and `npm run check`; the tests fail when the copy is out of date.

import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
writeFileSync(new URL('../src/ui/changelog.js', import.meta.url),
	`// Made from CHANGELOG.md by scripts/changelog.mjs: edit CHANGELOG.md, not this.\nexport const CHANGELOG = ${JSON.stringify(md)};\n`);
