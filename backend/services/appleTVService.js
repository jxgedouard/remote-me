'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { CompanionClient, discover } = require('../companion/client');
const { withIcons } = require('./appIcons');

const CREDENTIALS_FILE = path.join(__dirname, '../data/appletv-credentials.json');
const RECONNECT_DELAY_MS = 3000;

function loadCredentials() {
  try { return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveCredentials(data) {
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
}

const events = new EventEmitter();
let client = null;
let target = null; // { address, port, name, model }
let finishPairing = null;
let reconnectTimer = null;
let state = { status: 'idle', paired: false, device: null, power: 'unknown', media: null, touch: false, keyboard: { active: false }, error: null };

function setState(patch) {
  state = { ...state, ...patch };
  events.emit('state', state);
}

async function resolveTarget(ip, port) {
  if (ip && port) {
    const saved = loadCredentials()[ip] || {};
    return { address: ip, port: Number(port), name: saved.name || ip, model: saved.model || null };
  }
  const devices = await discover();
  const match = ip ? devices.find((d) => d.address === ip) : devices[0];
  if (!match) {
    throw new Error(ip
      ? `Aucune Apple TV Companion trouvée à ${ip}. Vérifie qu'elle est allumée et sur le même réseau.`
      : 'Aucune Apple TV trouvée sur le réseau.');
  }
  return match;
}

/** Devices paired by manual IP only know their address; fetch the real name/model via mDNS. */
function refreshDeviceName(t) {
  discover().then((devices) => {
    const found = devices.find((d) => d.address === t.address);
    if (!found || target !== t) return;
    target = { ...t, name: found.name, model: found.model };
    setState({ device: target });
    const all = loadCredentials();
    if (all[t.address]) {
      all[t.address] = { ...all[t.address], name: found.name, model: found.model };
      saveCredentials(all);
    }
  }).catch(() => {});
}

function attach(c) {
  c.on('close', () => {
    if (client !== c) return;
    setState({ status: 'disconnected', keyboard: { active: false } });
    scheduleReconnect();
  });
  c.on('mediaFlags', (media) => setState({ media }));
  c.on('power', (power) => setState({ power }));
  c.on('keyboard', (keyboard) => setState({ keyboard }));
  c.on('warning', (err) => console.warn('[AppleTV]', err.message));
  c.on('event', (id, content) => {
    console.log('[AppleTV] event', id, JSON.stringify(content).slice(0, 300));
    events.emit('deviceEvent', { id, content });
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const creds = target && loadCredentials()[target.address];
  if (!creds) return;
  reconnectTimer = setTimeout(() => {
    connectWithCredentials(creds).catch((err) => {
      console.warn('[AppleTV] reconnect failed:', err.message);
      scheduleReconnect();
    });
  }, RECONNECT_DELAY_MS);
}

async function connectWithCredentials(creds) {
  if (client) client.close();
  client = new CompanionClient({ host: target.address, port: target.port, name: 'remote_me' });
  attach(client);
  setState({ status: 'connecting', error: null });
  await client.connect(creds);
  setState({ status: 'connected', paired: true, touch: client.touchReady });
  client.powerState().then((power) => setState({ power })).catch(() => {});
}

async function connect(ip, port) {
  clearTimeout(reconnectTimer);
  target = await resolveTarget(ip, port);
  setState({ device: target, status: 'connecting', error: null });
  if (target.name === target.address) refreshDeviceName(target);

  const creds = loadCredentials()[target.address];
  if (!creds) {
    setState({ status: 'needs_pairing', paired: false });
    return state;
  }
  try {
    await connectWithCredentials(creds);
  } catch (err) {
    setState({ status: 'error', error: err.message });
    if (/Signature|Pairing refusé|authentication/i.test(err.message)) {
      const all = loadCredentials();
      delete all[target.address];
      saveCredentials(all);
      setState({ status: 'needs_pairing', paired: false });
    } else {
      throw err;
    }
  }
  return state;
}

async function startPairing() {
  if (!target) throw new Error("Choisis d'abord une Apple TV");
  if (client) client.close();
  const pairingClient = new CompanionClient({ host: target.address, port: target.port, name: 'remote_me' });
  finishPairing = await pairingClient.beginPairing();
  setState({ status: 'pairing' });
  return { status: 'waiting_for_pin' };
}

async function submitPin(pin) {
  if (!finishPairing) throw new Error('Pairing non démarré');
  const creds = await finishPairing(pin);
  finishPairing = null;
  const all = loadCredentials();
  all[target.address] = { ...creds, name: target.name, model: target.model, port: target.port };
  saveCredentials(all);
  await connectWithCredentials(creds);
  return state;
}

function forget() {
  if (target) {
    const all = loadCredentials();
    delete all[target.address];
    saveCredentials(all);
  }
  disconnect();
  setState({ status: 'needs_pairing', paired: false });
}

function active() {
  if (!client || !client.connected) throw new Error("Non connecté à l'Apple TV");
  return client;
}

function disconnect() {
  clearTimeout(reconnectTimer);
  const c = client;
  client = null;
  if (c) c.close();
  setState({ status: 'disconnected' });
}

/** Reconnects to the last paired Apple TV on startup. */
async function autoConnect() {
  const all = loadCredentials();
  const [address, saved] = Object.entries(all)[0] || [];
  if (!address) return;
  try { await connect(address, saved.port); }
  catch (err) { console.warn('[AppleTV] auto-connect failed:', err.message); scheduleReconnect(); }
}

module.exports = {
  events,
  getState: () => state,
  discover,
  connect,
  startPairing,
  submitPin,
  forget,
  disconnect,
  autoConnect,
  button: async (name, action) => {
    const c = active();
    // A physical remote wakes the Apple TV on any press; network HID does not, so wake it first.
    if (state.power === 'asleep' && !['sleep', 'wake'].includes(name)) {
      await c.button('wake');
      setState({ power: 'awake' });
    }
    await c.button(name, action);
    if (name === 'wake') setState({ power: 'awake' });
    if (name === 'sleep') setState({ power: 'asleep' });
  },
  touch: (x, y, phase) => active().touch(x, y, phase),
  media: (command) => active().media(command),
  skip: (seconds) => active().skip(seconds),
  setVolume: (pct) => active().setVolume(pct),
  apps: async () => withIcons(await active().apps()),
  launchApp: (id) => active().launchApp(id),
  setText: (text, opts) => active().setText(text, opts),
  power: async (on) => { await active().power(on); setState({ power: on ? 'awake' : 'asleep' }); },
  nowPlaying: () => active().nowPlaying(),
};
