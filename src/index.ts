/**
 * 7K Score Tracker for oss!idle: your recent 7K plays, their XP per skill, and the maps that give you the most XP per minute.
 *
 * The game imports this file and calls `mount` / `unmount`. `defineAddon` builds them from the class in Tracker.ts.
 */

import { defineAddon } from '@oss-idle/addon-sdk';
import { Tracker } from './Tracker.js';

export const { mount, unmount } = defineAddon(() => new Tracker());
