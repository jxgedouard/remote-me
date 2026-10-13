'use strict';

// App icons from the public App Store lookup API, cached on disk so each bundle is looked up once.
// tvOS apps share their bundle ID with the iOS listing, which carries the artwork.

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../data/app-icons.json');
const COUNTRIES = ['fr', 'us'];
// Built-in tvOS apps whose store listing uses another bundle ID.
const ALIASES = { 'com.apple.TVWatchList': 'com.apple.tv' };
// Apple apps worth showing next to downloaded ones; the other com.apple.* are system utilities.
const NATIVE_KEEP = new Set(['com.apple.TVWatchList']);

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch { return {}; }
}

async function lookup(bundleIds, country) {
  const url = `https://itunes.apple.com/lookup?bundleId=${bundleIds.map(encodeURIComponent).join(',')}&country=${country}&entity=software`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`App Store lookup ${res.status}`);
  const { results = [] } = await res.json();
  return new Map(results.map((r) => [r.bundleId.toLowerCase(), (r.artworkUrl512 || r.artworkUrl100 || '').replace(/512x512bb\./, '256x256bb.')]));
}

/** Icon URL (or null) for each App Store bundle ID, looked up once and cached. */
async function iconsFor(bundleIds) {
  const cache = loadCache();
  let missing = [...new Set(bundleIds)].filter((id) => !(id in cache));
  for (const country of COUNTRIES) {
    if (!missing.length) break;
    try {
      const found = await lookup(missing.map((id) => ALIASES[id] || id), country);
      for (const id of missing) {
        const icon = found.get((ALIASES[id] || id).toLowerCase());
        if (icon) cache[id] = icon;
      }
      missing = missing.filter((id) => !(id in cache));
    } catch (err) {
      console.warn('[AppIcons]', err.message);
      missing = []; // offline: retry on the next refresh instead of caching misses
    }
  }
  // Remember misses too (system apps have no listing) so we do not query them every time.
  for (const id of missing) cache[id] = null;
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  return Object.fromEntries(bundleIds.map((id) => [id, cache[id] || null]));
}

/** Adds `icon` (URL or null) and `system` (Apple utility app) to each { bundleId, name }. */
async function withIcons(apps) {
  const icons = await iconsFor(apps.map((a) => a.bundleId));
  return apps.map((a) => ({
    ...a,
    icon: icons[a.bundleId],
    system: a.bundleId.startsWith('com.apple.') && !NATIVE_KEEP.has(a.bundleId),
  }));
}

module.exports = { withIcons, iconsFor };
