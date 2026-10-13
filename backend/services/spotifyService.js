'use strict';

// Spotify Connect control (Web API + Authorization Code with PKCE, no client secret).
// Tokens live on the backend so every device using the remote shares one login.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '../data/spotify.json');
const REDIRECT_URI = 'http://127.0.0.1:3001/api/spotify/callback';
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative',
].join(' ');

const pendingLogins = new Map(); // state -> { verifier, returnTo, at }

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { return {}; }
}

function save(data) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function status() {
  const s = load();
  return { configured: !!s.clientId, loggedIn: !!s.refreshToken, redirectUri: REDIRECT_URI };
}

function setClientId(clientId) {
  if (!/^[0-9a-f]{32}$/i.test(clientId || '')) throw new Error('Client ID Spotify invalide (32 caractères hexadécimaux)');
  const s = load();
  save({ ...s, clientId, accessToken: null, refreshToken: null, expiresAt: 0 });
  return status();
}

function logout() {
  const s = load();
  save({ clientId: s.clientId });
  return status();
}

function loginUrl(returnTo) {
  const { clientId } = load();
  if (!clientId) throw new Error("Ajoute d'abord ton Client ID Spotify");
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  pendingLogins.set(state, { verifier, returnTo, at: Date.now() });
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  return `https://accounts.spotify.com/authorize?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Spotify: ${data.error_description || data.error || res.status}`);
  return data;
}

function storeTokens(data) {
  const s = load();
  save({
    ...s,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || s.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });
}

async function handleCallback({ code, state, error }) {
  const pending = pendingLogins.get(state);
  pendingLogins.delete(state);
  if (error) throw new Error(`Connexion Spotify refusée: ${error}`);
  if (!pending) throw new Error('Session de connexion Spotify expirée, recommence');
  const { clientId } = load();
  storeTokens(await tokenRequest({
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: pending.verifier,
  }));
  return pending.returnTo;
}

async function accessToken() {
  const s = load();
  if (!s.refreshToken) throw new Error('Spotify non connecté');
  if (s.accessToken && Date.now() < s.expiresAt) return s.accessToken;
  storeTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId }));
  return load().accessToken;
}

async function api(method, endpoint, { query, body } = {}) {
  const url = new URL(`https://api.spotify.com/v1${endpoint}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error?.message || res.status;
    if (data?.error?.reason === 'PREMIUM_REQUIRED') throw new Error('Spotify Premium est nécessaire pour piloter la lecture');
    throw new Error(`Spotify: ${msg}`);
  }
  return data;
}

/** Finds the Apple TV among Spotify Connect devices (only listed while the Spotify app is open on it). */
async function findAppleTV(nameHint) {
  const { devices = [] } = await api('GET', '/me/player/devices') || {};
  const hint = (nameHint || '').toLowerCase();
  return devices.find((d) => hint && d.name.toLowerCase() === hint)
    || devices.find((d) => d.type === 'TV' || /apple tv/i.test(d.name))
    || null;
}

async function player() {
  const p = await api('GET', '/me/player', { query: { additional_types: 'episode' } });
  if (!p) return { active: false };
  const item = p.item || {};
  return {
    active: true,
    playing: p.is_playing,
    device: p.device ? { id: p.device.id, name: p.device.name, type: p.device.type, volume: p.device.volume_percent } : null,
    track: item.name ? {
      title: item.name,
      artist: (item.artists || []).map((a) => a.name).join(', ') || item.show?.name || '',
      album: item.album?.name || '',
      artwork: (item.album?.images || item.images || [])[0]?.url || null,
      durationMs: item.duration_ms,
      progressMs: p.progress_ms,
    } : null,
  };
}

async function playlists() {
  const data = await api('GET', '/me/playlists', { query: { limit: 30 } });
  return (data?.items || []).filter(Boolean).map((p) => ({
    id: p.id, name: p.name, uri: p.uri, image: p.images?.[0]?.url || null, tracks: p.tracks?.total ?? null,
  }));
}

const image = (images) => (images || []).slice(-2)[0]?.url || images?.[0]?.url || null;

/** Catalog search, grouped the way the panel shows it. */
async function search(q) {
  const data = await api('GET', '/search', { query: { q, type: 'track,artist,album,playlist', limit: 8 } });
  const tracks = (data?.tracks?.items || []).filter(Boolean).map((t) => ({
    id: t.id, uri: t.uri, kind: 'track', name: t.name,
    subtitle: t.artists.map((a) => a.name).join(', '), image: image(t.album?.images),
  }));
  const artists = (data?.artists?.items || []).filter(Boolean).map((a) => ({
    id: a.id, uri: a.uri, kind: 'artist', name: a.name, subtitle: 'Artiste', image: image(a.images),
  }));
  const albums = (data?.albums?.items || []).filter(Boolean).map((a) => ({
    id: a.id, uri: a.uri, kind: 'album', name: a.name,
    subtitle: a.artists.map((x) => x.name).join(', '), image: image(a.images),
  }));
  const playlists = (data?.playlists?.items || []).filter(Boolean).map((p) => ({
    id: p.id, uri: p.uri, kind: 'playlist', name: p.name, subtitle: p.owner?.display_name || 'Playlist', image: image(p.images),
  }));
  return { tracks, artists, albums, playlists };
}

/** Tracks play as a single URI; albums, playlists and artists as a context. */
async function play({ deviceId, contextUri } = {}) {
  const body = !contextUri ? undefined
    : contextUri.startsWith('spotify:track:') ? { uris: [contextUri] }
      : { context_uri: contextUri };
  await api('PUT', '/me/player/play', { query: { device_id: deviceId }, body });
}

const control = {
  pause: () => api('PUT', '/me/player/pause'),
  resume: () => api('PUT', '/me/player/play'),
  next: () => api('POST', '/me/player/next'),
  previous: () => api('POST', '/me/player/previous'),
  volume: (pct) => api('PUT', '/me/player/volume', { query: { volume_percent: Math.round(pct) } }),
  transfer: (deviceId) => api('PUT', '/me/player', { body: { device_ids: [deviceId], play: true } }),
};

module.exports = { status, setClientId, logout, loginUrl, handleCallback, findAppleTV, player, playlists, search, play, control, REDIRECT_URI };
