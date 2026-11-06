/**
 * lib-paths.mjs — where things live.
 *
 * The dashboard is its own folder, but coach-router stays the home of the
 * registry (coaches.json), the step list (steps.mjs), the live checks and every
 * command that writes. The dashboard reads and runs those; it never keeps a
 * second copy of any of them.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DASH = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(DASH, '..');
export const COACH_ROUTER = resolve(REPO_ROOT, 'coach-router');
