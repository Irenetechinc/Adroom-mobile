/**
 * Replaces Replit's internal package-firewall proxy URLs in package-lock.json
 * with the real npm registry so EAS builds (which run outside Replit's network)
 * can resolve every package.
 *
 * Why this is needed:
 *   When `npm install` runs inside Replit, the registry is proxied through
 *   http://package-firewall.replit.local/npm/.  The resolved URLs stored in
 *   package-lock.json point to that hostname.  EAS cloud builders (and any CI
 *   outside Replit) cannot reach that host, so `npm ci` fails with ENOTFOUND.
 *
 * This script is idempotent — safe to run multiple times.
 * Runs via "postinstall" on every `npm install` / `npm ci` (including EAS).
 */

const fs   = require('fs');
const path = require('path');

const LOCKFILE  = path.join(__dirname, '..', 'package-lock.json');
const REPLIT_RE = /http:\/\/package-firewall\.replit\.local\/npm\//g;
const NPM_URL   = 'https://registry.npmjs.org/';

if (!fs.existsSync(LOCKFILE)) {
  console.log('[scrub-lockfile] package-lock.json not found, skipping.');
  return;
}

const original = fs.readFileSync(LOCKFILE, 'utf-8');
const scrubbed = original.replace(REPLIT_RE, NPM_URL);

if (scrubbed === original) {
  console.log('[scrub-lockfile] no Replit proxy URLs found, nothing to do.');
} else {
  const count = (original.match(REPLIT_RE) || []).length;
  fs.writeFileSync(LOCKFILE, scrubbed, 'utf-8');
  console.log(`[scrub-lockfile] replaced ${count} Replit proxy URL(s) with ${NPM_URL}`);
}
