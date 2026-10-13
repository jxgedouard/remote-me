'use strict';

// LG webOS TV over SSAP (the protocol LG's own phone apps use), via lgtv2.
// Verified live on OLED65B6V-Z / webOS 3.0 (firmware 05.70.55):
//  * settings reads (ssap://settings/getSystemSettings) answer 500 and the createAlert
//    "luna" workaround does not exist before webOS 4, so values cannot be read or written
//    generically; the settings app does accept a `target` to open a section directly;
//  * sound output can be changed (apiadapter -> setSystemSettings internally);
//  * button presses go through the pointer input socket.

const LGTV = require('lgtv2');
const path = require('path');
const fs = require('fs');
const wol = require('wol');
const { iconsFor } = require('./appIcons');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '../data');
const CONFIG_FILE = path.join(DATA_DIR, 'lgtv.json');
const RECONNECT_DELAY_MS = 5000;
const STATUS_POLL_MS = 5000;

// Sections the webOS 3 settings app opens directly (others fall back to Picture).
const SETTINGS_SECTIONS = ['picture', 'sound', 'channel', 'network', 'general', 'accessibility'];
const SOUND_OUTPUTS = ['tv_speaker', 'external_speaker', 'external_arc', 'bt_soundbar', 'headphone'];
// Pointer-socket button names accepted by webOS.
const BUTTONS = new Set([
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'EXIT', 'HOME', 'MENU', 'INFO',
  'RED', 'GREEN', 'YELLOW', 'BLUE', 'CHANNELUP', 'CHANNELDOWN', 'VOLUMEUP', 'VOLUMEDOWN', 'MUTE',
  'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FASTFORWARD', 'DASH', 'ASTERISK', 'CC',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);
// Visible built-in apps that are setup wizards or plumbing rather than something to open.
const SYSTEM_APPS = new Set([
  'com.webos.app.voice', 'com.webos.app.tvuserguide', 'com.webos.app.connectionwizard', 'com.webos.app.camera',
  'com.webos.app.notificationcenter', 'com.webos.app.accessibility', 'com.webos.app.scheduler',
  'com.webos.app.multiview', 'com.webos.app.discovery', 'com.webos.app.recordings',
]);

// The TV's own icon URLs answer 404 on this firmware: borrow the App Store artwork instead.
const STORE_IDS = {
  netflix: 'com.netflix.Netflix', 'youtube.leanback.v4': 'com.google.ios.youtube', 'amazon.global': 'com.amazon.aiv.AIVApp',
  'com.disney.disneyplus-prod': 'com.disney.disneyplus', 'cdp-30': 'com.plexapp.plex', 'spotify-beehive': 'com.spotify.client',
};

const events = new EventEmitter();
let tv = null;
let reconnectTimer = null;
let pollTimer = null;
let state = { status: 'idle', ip: null, model: null, power: 'unknown', app: null, soundOutput: null, volume: null, muted: false, error: null };

function setState(patch) {
  state = { ...state, ...patch };
  events.emit('state', state);
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function saveConfig(patch) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...loadConfig(), ...patch }, null, 2));
}

const keyFile = (ip) => path.join(DATA_DIR, `lgtv-${ip.replace(/\./g, '_')}`);

function request(uri, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!tv || state.status !== 'connected') return reject(new Error('TV LG non connectée'));
    tv.request(uri, payload, (err, res) => {
      if (err) reject(new Error(`TV LG: ${err.message}`));
      else if (res && res.returnValue === false) reject(new Error(`TV LG: ${res.errorText || 'commande refusée'}`));
      else resolve(res);
    });
  });
}

/** Button presses go through the pointer input socket (lgtv2 keeps it open between presses). */
async function button(name) {
  const key = String(name || '').toUpperCase();
  if (!BUTTONS.has(key)) throw new Error(`Touche inconnue: ${name}`);
  if (!tv || state.status !== 'connected') throw new Error('TV LG non connectée');
  const sock = await tv.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket');
  sock.send('button', { name: key });
}

async function refreshStatus() {
  const [audio, output, app] = await Promise.allSettled([
    request('ssap://audio/getStatus'),
    request('ssap://com.webos.service.apiadapter/audio/getSoundOutput'),
    request('ssap://com.webos.applicationManager/getForegroundAppInfo'),
  ]);
  const patch = {};
  if (audio.status === 'fulfilled') {
    // -1 means the sound goes to an external device the TV cannot set (optical).
    patch.volume = audio.value.volume >= 0 ? audio.value.volume : null;
    patch.muted = !!audio.value.mute;
  }
  if (output.status === 'fulfilled') patch.soundOutput = output.value.soundOutput;
  if (app.status === 'fulfilled') patch.app = app.value.appId || null;
  setState(patch);
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (state.status === 'connected') refreshStatus().catch(() => {}); }, STATUS_POLL_MS);
}

function teardown() {
  clearInterval(pollTimer);
  if (tv) { const old = tv; tv = null; old.removeAllListeners(); try { old.disconnect(); } catch { /* already closed */ } }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const { ip } = loadConfig();
  if (!ip) return;
  reconnectTimer = setTimeout(() => connect(ip).catch(() => scheduleReconnect()), RECONNECT_DELAY_MS);
}

/** Resolves once paired and connected; the first time, the TV shows an authorization prompt. */
function connect(ip) {
  clearTimeout(reconnectTimer);
  teardown();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  setState({ status: 'connecting', ip, error: null });

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const c = LGTV({ host: ip, keyFile: keyFile(ip), reconnect: false, timeout: 8000 });
    tv = c;

    c.on('prompt', () => setState({ status: 'prompt' }));
    c.on('connect', async () => {
      if (tv !== c) return;
      saveConfig({ ip });
      setState({ status: 'connected', power: 'on', error: null });
      request('ssap://system/getSystemInfo').then((i) => setState({ model: i.modelName })).catch(() => {});
      request('ssap://com.webos.service.connectionmanager/getinfo').then((n) => {
        const macs = [n.wifiInfo?.macAddress, n.wiredInfo?.macAddress].filter(Boolean);
        if (macs.length) saveConfig({ macs });
      }).catch(() => {});
      refreshStatus().catch(() => {});
      startPolling();
      // Live volume: follows the physical remote too. -1 = external speaker the TV cannot set.
      c.subscribe('ssap://audio/getVolume', {}, (err, res) => {
        if (err || tv !== c || !res || typeof res.volume !== 'number') return;
        setState({ volume: res.volume >= 0 ? res.volume : null, muted: !!(res.muted ?? res.mute) });
      });
      done(resolve, state);
    });
    c.on('close', () => {
      if (tv !== c) return;
      teardown();
      setState({ status: 'disconnected', power: 'off' });
      scheduleReconnect();
    });
    c.on('error', (err) => {
      if (tv !== c) return;
      if (!settled) {
        teardown();
        setState({ status: 'error', error: `TV LG injoignable (${err.message})` });
        done(reject, new Error(`TV LG injoignable à ${ip}. Vérifie qu'elle est allumée.`));
      }
    });
    const timer = setTimeout(() => {
      if (state.status === 'prompt') return; // waiting for the user on the TV
      teardown();
      setState({ status: 'error', error: 'Pas de réponse de la TV LG' });
      done(reject, new Error('Pas de réponse de la TV LG'));
    }, 15000);
    c.on('prompt', () => done(resolve, state));
  });
}

function forget() {
  clearTimeout(reconnectTimer);
  teardown();
  const { ip } = loadConfig();
  if (ip) { try { fs.unlinkSync(keyFile(ip)); } catch { /* not paired */ } }
  fs.rmSync(CONFIG_FILE, { force: true });
  setState({ status: 'idle', ip: null, model: null, power: 'unknown', app: null, soundOutput: null, volume: null });
}

/** Wake-on-LAN on every known MAC (Wi-Fi and Ethernet); needs "Allumer via Wi-Fi" on the TV. */
async function powerOn() {
  const { macs = [], ip } = loadConfig();
  if (!macs.length) throw new Error("Adresse MAC inconnue: connecte-toi une fois à la TV allumée");
  await Promise.all(macs.map((mac) => new Promise((resolve) => wol.wake(mac, () => resolve()))));
  if (ip) setTimeout(() => connect(ip).catch(() => scheduleReconnect()), 4000);
  return { status: 'wol_sent' };
}

async function powerOff() {
  await request('ssap://system/turnOff');
  setState({ power: 'off' });
}

async function apps() {
  const res = await request('ssap://com.webos.applicationManager/listApps');
  const icons = await iconsFor(Object.values(STORE_IDS)).catch(() => ({}));
  return (res.apps || [])
    .filter((a) => a.visible !== false)
    .map((a) => ({
      id: a.id,
      title: a.title,
      icon: icons[STORE_IDS[a.id]] || null,
      system: SYSTEM_APPS.has(a.id),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function inputs() {
  const res = await request('ssap://tv/getExternalInputList');
  return (res.devices || []).map((d) => ({ id: d.id, label: d.label, appId: d.appId, connected: !!d.connected }));
}

async function openSettings(section) {
  if (section && !SETTINGS_SECTIONS.includes(section)) throw new Error(`Section inconnue: ${section}`);
  await request('ssap://system.launcher/launch', { id: 'com.palm.app.settings', params: section ? { target: section } : {} });
}

async function setSoundOutput(output) {
  if (!SOUND_OUTPUTS.includes(output)) throw new Error(`Sortie son inconnue: ${output}`);
  await request('ssap://com.webos.service.apiadapter/audio/changeSoundOutput', { output });
  setState({ soundOutput: output });
}

async function setVolume(volume) {
  if (state.volume === null) throw new Error("Le son sort sur une enceinte externe : la TV ne peut pas régler son volume");
  const v = Math.max(0, Math.min(100, Math.round(volume)));
  await request('ssap://audio/setVolume', { volume: v });
  setState({ volume: v });
}

async function setMute(mute) {
  await request('ssap://audio/setMute', { mute: !!mute });
  setState({ muted: !!mute });
}

/** Types into the TV's on-screen keyboard (search fields, browser...). */
async function text(value, { submit = false } = {}) {
  await request('ssap://com.webos.service.ime/deleteCharacters', { count: 200 }).catch(() => {});
  if (value) await request('ssap://com.webos.service.ime/insertText', { text: value, replace: 0 });
  if (submit) await request('ssap://com.webos.service.ime/sendEnterKey');
}

const launch = (id) => request('ssap://system.launcher/launch', { id });
const switchInput = (inputId) => request('ssap://tv/switchInput', { inputId });
const toast = (message) => request('ssap://system.notifications/createToast', { message });
const media = (action) => {
  const uri = { play: 'play', pause: 'pause', stop: 'stop', rewind: 'rewind', fastForward: 'fastForward' }[action];
  if (!uri) throw new Error(`Commande média inconnue: ${action}`);
  return request(`ssap://media.controls/${uri}`);
};

/** Reconnects to the saved TV on server start; keeps retrying quietly while it is off. */
function autoConnect() {
  const { ip } = loadConfig();
  if (!ip || !fs.existsSync(keyFile(ip))) return;
  connect(ip).catch(() => scheduleReconnect());
}

module.exports = {
  events,
  getState: () => state,
  settingsSections: SETTINGS_SECTIONS,
  soundOutputs: SOUND_OUTPUTS,
  connect, forget, autoConnect,
  button, powerOn, powerOff, apps, inputs, launch, switchInput,
  openSettings, setSoundOutput, setVolume, setMute, text, toast, media,
};
