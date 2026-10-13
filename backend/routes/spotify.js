'use strict';

const express = require('express');
const router = express.Router();
const spotify = require('../services/spotifyService');
const atv = require('../services/appleTVService');

const SPOTIFY_BUNDLE = 'com.spotify.client';

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/** Opens Spotify on the Apple TV (if connected) and waits for it to show up in Spotify Connect. */
async function ensureAppleTVDevice() {
  const hint = atv.getState().device?.name;
  let device = await spotify.findAppleTV(hint);
  if (device) return device;
  try { await atv.launchApp(SPOTIFY_BUNDLE); }
  catch { throw new Error("L'Apple TV n'apparaît pas dans Spotify Connect. Ouvre Spotify sur la TV puis réessaie."); }
  for (let i = 0; i < 12 && !device; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    device = await spotify.findAppleTV(hint);
  }
  if (!device) throw new Error("Spotify est ouvert sur l'Apple TV mais pas encore visible. Réessaie dans quelques secondes.");
  return device;
}

// GET /api/spotify/status
router.get('/status', handle(() => spotify.status()));

// POST /api/spotify/config  { clientId }
router.post('/config', handle((req) => spotify.setClientId((req.body.clientId || '').trim())));

// POST /api/spotify/logout
router.post('/logout', handle(() => spotify.logout()));

// GET /api/spotify/login?returnTo=...  — must be opened on http://127.0.0.1:3001 (Spotify loopback redirect rule)
router.get('/login', (req, res) => {
  try { res.redirect(spotify.loginUrl(req.query.returnTo || 'http://localhost:5173/')); }
  catch (err) { res.status(400).send(err.message); }
});

// GET /api/spotify/callback
router.get('/callback', async (req, res) => {
  try {
    const returnTo = await spotify.handleCallback(req.query);
    const url = new URL(returnTo);
    url.searchParams.set('spotify', 'connected');
    res.redirect(url.toString());
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// GET /api/spotify/player
router.get('/player', handle(() => spotify.player()));

// GET /api/spotify/playlists
router.get('/playlists', handle(() => spotify.playlists()));

// GET /api/spotify/search?q=...
router.get('/search', handle((req) => {
  const q = String(req.query.q || '').trim();
  if (!q) return { tracks: [], artists: [], albums: [], playlists: [] };
  return spotify.search(q);
}));

// POST /api/spotify/play-on-tv  { contextUri? } — a track, album, playlist or artist URI
router.post('/play-on-tv', handle(async (req) => {
  const device = await ensureAppleTVDevice();
  await spotify.play({ deviceId: device.id, contextUri: req.body.contextUri });
  return { status: 'ok', device: device.name };
}));

// POST /api/spotify/control  { action: pause|resume|next|previous|volume, value? }
router.post('/control', handle(async (req) => {
  const { action, value } = req.body;
  const fn = spotify.control[action];
  if (!fn || action === 'transfer') throw new Error(`Action inconnue: ${action}`);
  await fn(value);
  return { status: 'ok' };
}));

module.exports = router;
