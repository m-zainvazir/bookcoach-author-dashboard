/**
 * lib-settings.mjs — the pipeline's local switches, in pipeline.local.json.
 *
 * Gitignored by the root `*.local.*` rule. Local-only: nothing here is ever
 * pushed to KV or the Worker. Plan: ghl-shopify subscription/plans/22-pipeline-dashboard.md §5.
 *
 * EVERY SWITCH DEFAULTS TO OFF. Turning one on is a deliberate act, and turning
 * it off must actually stop the thing (lib-switches.mjs does that) — not hide it.
 *
 *   guidance        the /next-step Claude Code skill is installed (on) or removed (off)
 *   alertsLocal     a Windows scheduled task runs the health checks (on) or is deleted (off)
 *   alertsUptime    the external uptime monitor is resumed (on) or paused (off)
 *   landingPages    the /landing-page skill is installed, and the "Generate with Claude
 *                   Code" button shown (on) — or the skill removed, the button gone (off)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DASH } from './lib-paths.mjs';

// The choices for the landing-page chat (lib-landing.mjs claudeLaunch checks them again).
export const MODELS = ['sonnet', 'opus', 'haiku', 'fable'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const SETTINGS_FILE = `${DASH}/pipeline.local.json`;

export const SETTING_DEFAULTS = {
  guidance: 'off',
  alertsLocal: 'off',
  alertsIntervalMinutes: 60,
  alertsUptime: 'off',
  landingPages: 'off',
  // The chat "Generate with Claude Code" opens: Sonnet at medium effort (decided 2026-10-12).
  landingModel: 'sonnet',
  landingEffort: 'medium',
  // '' = manage the uptime monitor by hand at the provider; 'uptimerobot' = by API.
  uptimeProvider: '',
  uptimeApiKey: '',
  uptimeMonitorId: '',
  // GHL contact ids that hold a coach tag on purpose (staff, comps). H5 skips them.
  knownGrants: [],
  dashboardPort: 5178,
  // 0 = refresh only when asked. Otherwise no faster than every 15 minutes.
  autoRefreshMinutes: 0,
  // The Access tab's "ending soon": trials ending within this many days (plan 07, decided 2026-11-05).
  accessSoonDays: 5,
};

/** What each switch is, for `config` with no arguments and the dashboard. */
export const SETTING_HELP = {
  guidance: 'on|off — install the /next-step Claude Code skill (off removes it)',
  alertsLocal: 'on|off — hourly health check with a desktop notification on change (off deletes the task)',
  alertsIntervalMinutes: '15-1440 — how often the local health check runs',
  alertsUptime: 'on|off — the external /health monitor (paused when off)',
  landingPages: 'on|off — install the /landing-page skill + the dashboard\'s "Generate with Claude Code" button (off removes both)',
  landingModel: 'sonnet|opus|haiku|fable — the model that chat uses',
  landingEffort: 'low|medium|high|xhigh|max — its effort',
  uptimeProvider: '"" (manual) or uptimerobot',
  uptimeApiKey: 'the provider\'s API key (never shown or sent to the dashboard)',
  uptimeMonitorId: 'the monitor\'s id at the provider',
  knownGrants: 'GHL contact ids that hold a coach tag on purpose — use --known-grant / --unknown-grant',
  dashboardPort: '1024-65535 — the local dashboard port',
  autoRefreshMinutes: '0 (off) or 15-1440 — dashboard auto-refresh',
  accessSoonDays: '1-30 — the Access tab shows trials ending within this many days as "ending soon"',
};

const SECRET_KEYS = ['uptimeApiKey'];
const onOff = (v) => (v === 'on' || v === 'off' ? [v, null] : [null, 'must be on or off']);

/** Validate one value. Returns [value, problem]. */
export function parseSetting(key, raw) {
  const s = typeof raw === 'string' ? raw.trim() : raw;
  switch (key) {
    case 'guidance':
    case 'alertsLocal':
    case 'alertsUptime':
    case 'landingPages':
      return onOff(String(s).toLowerCase());
    case 'landingModel':
      return MODELS.includes(String(s)) ? [String(s), null] : [null, `must be one of ${MODELS.join(', ')}`];
    case 'landingEffort':
      return EFFORTS.includes(String(s)) ? [String(s), null] : [null, `must be one of ${EFFORTS.join(', ')}`];
    case 'alertsIntervalMinutes': {
      const n = Number(s);
      return Number.isInteger(n) && n >= 15 && n <= 1440 ? [n, null] : [null, 'must be a whole number of minutes, 15-1440'];
    }
    case 'autoRefreshMinutes': {
      const n = Number(s);
      return Number.isInteger(n) && (n === 0 || (n >= 15 && n <= 1440)) ? [n, null] : [null, 'must be 0 (off) or 15-1440 — never faster, to stay light on the APIs'];
    }
    case 'accessSoonDays': {
      const n = Number(s);
      return Number.isInteger(n) && n >= 1 && n <= 30 ? [n, null] : [null, 'must be a whole number of days, 1-30'];
    }
    case 'dashboardPort': {
      const n = Number(s);
      return Number.isInteger(n) && n >= 1024 && n <= 65535 ? [n, null] : [null, 'must be a port number, 1024-65535'];
    }
    case 'uptimeProvider':
      return s === '' || s === 'uptimerobot' ? [s, null] : [null, 'must be "" (manual) or uptimerobot'];
    case 'uptimeApiKey':
    case 'uptimeMonitorId':
      return [String(s || ''), null];
    case 'knownGrants':
      return Array.isArray(s) && s.every((x) => /^[A-Za-z0-9]{10,40}$/.test(String(x)))
        ? [[...new Set(s.map(String))], null]
        : [null, 'must be a list of GHL contact ids'];
    default:
      return [null, `unknown setting "${key}". Known: ${Object.keys(SETTING_DEFAULTS).join(', ')}`];
  }
}

/** Defaults overlaid with the file. A broken file reads as defaults — all off. */
export function readSettings({ file = SETTINGS_FILE } = {}) {
  let stored = {};
  try {
    stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    stored = {};
  }
  const out = { ...SETTING_DEFAULTS };
  for (const k of Object.keys(SETTING_DEFAULTS)) {
    if (stored[k] === undefined) continue;
    const [v, problem] = parseSetting(k, stored[k]);
    if (!problem) out[k] = v;
  }
  return out;
}

/**
 * Apply `changes` and write the file. Every key is validated first, and one bad
 * value writes nothing. Returns the new settings.
 */
export function writeSettings(changes, { file = SETTINGS_FILE } = {}) {
  const problems = [];
  const clean = {};
  for (const [k, raw] of Object.entries(changes)) {
    const [v, problem] = parseSetting(k, raw);
    if (problem) problems.push(`${k}: ${problem}`);
    else clean[k] = v;
  }
  if (problems.length) throw new Error(`Nothing written:\n  x ${problems.join('\n  x ')}`);
  const next = { ...readSettings({ file }), ...clean };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** Safe to show anywhere: secrets replaced by whether they are set. */
export function publicSettings(s) {
  const out = { ...s };
  for (const k of SECRET_KEYS) {
    out[`${k}Set`] = !!out[k];
    delete out[k];
  }
  return out;
}
