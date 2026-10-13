'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Bonjour } = require('bonjour-service');
const { CompanionConnection } = require('./connection');
const { pairSetupStart, pairVerify } = require('./pairing');
const { float } = require('./opack');
const keyboard = require('./keyboard');

// HID commands from TVRemoteCore's button table (see docs/apple-remote-protocol.md).
const HID = {
  up: 1, down: 2, left: 3, right: 4, menu: 5, select: 6, home: 7,
  volume_up: 8, volume_down: 9, siri: 10, screensaver: 11, sleep: 12, wake: 13,
  playpause: 14, channel_up: 15, channel_down: 16, guide: 17, page_up: 18, page_down: 19,
};
const ButtonState = { down: 1, up: 2 };
// While a touch session is open, tvOS drops HID arrow commands (select/menu/home still work).
// Verified live on AppleTV14,1: HIDTouchStop then HIDCommand 4 moves focus, without it nothing happens.
const ARROWS = new Set([HID.up, HID.down, HID.left, HID.right]);

const MediaCommand = {
  play: 1, pause: 2, next: 3, previous: 4, get_volume: 5, set_volume: 6, skip_by: 7,
  ff_begin: 8, ff_end: 9, rewind_begin: 10, rewind_end: 11,
};
const MediaFlags = {
  play: 0x01, pause: 0x02, previous: 0x04, next: 0x08, fast_forward: 0x10, rewind: 0x20,
  volume: 0x100, skip_forward: 0x200, skip_backward: 0x400,
};
// TVRemoteCore -[TVRCRPCompanionLinkClientWrapper _updateAttentionState:]: 1 = Asleep, 2/3 = awake variants.
const AttentionState = { 0: 'unknown', 1: 'asleep', 2: 'awake', 3: 'awake', 4: 'awake' };

const TOUCH_SIZE = 1000;
// Legacy Rapport phases (_hidT) vs TVRemoteCore phases (HIDTouch: Began 1, Moved 2, Ended 3).
const LegacyTouchPhase = { press: 1, hold: 3, release: 4 };
const TouchPhase = { press: 1, hold: 2, release: 3 };

function discover(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const found = new Map();
    const browser = bonjour.find({ type: 'companion-link' }, (svc) => {
      const address = (svc.addresses || []).find((a) => a.includes('.')) || svc.referer?.address;
      if (!address) return;
      const txt = svc.txt || {};
      const model = txt.rpMd || txt.rpmd || '';
      if (!model.startsWith('AppleTV')) return; // skip iPads, HomePods, Macs
      found.set(address, {
        name: svc.name,
        address,
        port: svc.port,
        model: txt.rpMd || txt.rpmd || null,
        rapportVersion: txt.rpVr || txt.rpvr || null,
        mac: txt.rpMac || txt.rpmac || null,
      });
    });
    setTimeout(() => { browser.stop(); bonjour.destroy(); resolve([...found.values()]); }, timeoutMs);
  });
}

class CompanionClient extends EventEmitter {
  constructor({ host, port, name = 'remote_me' }) {
    super();
    this.host = host;
    this.port = port;
    this.name = name;
    this.conn = null;
    this.mediaFlags = 0;
    this.touchReady = false;
    this.touchActive = false;
    this.touchOp = Promise.resolve();
    this.tvrc = false;
    this.textInput = null; // { session, text, title } while a text field is focused on the Apple TV
  }

  get connected() { return !!this.conn?.connected; }

  async _open() {
    this.close();
    const conn = new CompanionConnection(this.host, this.port);
    conn.on('event', (id, content) => this._onEvent(id, content));
    conn.on('error', (err) => this.emit('warning', err));
    conn.on('close', () => { this.touchReady = false; this.touchActive = false; this.emit('close'); });
    await conn.open();
    this.conn = conn;
    return conn;
  }

  /** Opens a fresh connection and asks the Apple TV to show a PIN. */
  async beginPairing() {
    const conn = await this._open();
    const finish = await pairSetupStart(conn, this.name);
    return async (pin) => {
      const creds = await finish(pin);
      this.close();
      return creds;
    };
  }

  /** Connects with stored credentials and runs the same session bootstrap as the native remote. */
  async connect(creds) {
    const conn = await this._open();
    await pairVerify(conn, creds);

    await conn.request('_systemInfo', {
      _bf: 0, _cf: 512, _clFl: 128, _i: crypto.randomBytes(6).toString('hex'),
      _idsID: creds.clientId, _pubID: crypto.randomBytes(6).toString('hex').match(/../g).join(':').toUpperCase(),
      _sf: 256, _sv: '170.18', model: 'iPhone17,1', name: this.name,
    });
    await conn.request('_sessionStart', { _srvT: 'com.apple.tvremoteservices', _sid: crypto.randomInt(1, 0x7fffffff) });

    // iOS 27 TVRemoteCore opens its own session before any HID / app / status request
    // (-[TVRCRPCompanionLinkClientWrapper _sendSessionStartWithCompletion:]). Without it,
    // the Apple TV silently ignores FetchLaunchableApplicationsEvent and friends.
    try {
      await conn.request('TVRCSessionStart', { ProtocolVersionKey: '1.2' }, 5000);
      this.tvrc = true;
    } catch (err) {
      this.tvrc = false;
      this.emit('warning', new Error(`TVRCSessionStart refusé, protocole legacy: ${err.message}`));
    }

    conn.event('_interest', {
      _regEvents: ['_iMC', 'MediaControlStatus', 'TVSystemStatus', 'NowPlayingInfo', 'SupportedActions'],
    });

    try {
      await this._touchSession(true);
      this.touchReady = true;
    } catch (err) {
      this.emit('warning', err);
    }

    // Subscribes to _tiStarted/_tiStopped; the response already describes a field focused right now.
    this.textInputStart().catch((err) => this.emit('warning', err));
  }

  _setTextInput(tiD) {
    let next = null;
    if (tiD) {
      try { next = keyboard.parseTextInput(tiD); }
      catch (err) { this.emit('warning', new Error(`_tiD illisible: ${err.message}`)); }
    }
    this.textInput = next?.session ? next : null;
    this.emit('keyboard', this.textInput ? { active: true, text: this.textInput.text, title: this.textInput.title } : { active: false });
  }

  async textInputStart() {
    const res = await this._require().request('_tiStart', {}, 5000);
    this._setTextInput(res._tiD);
    return this.textInput;
  }

  /** Replaces the focused field's content (what the iOS remote keyboard does on every keystroke). */
  async setText(text, { submit = false } = {}) {
    const conn = this._require();
    if (!this.textInput) await this.textInputStart();
    if (!this.textInput) throw new Error("Aucun champ texte actif sur l'Apple TV");
    const { session } = this.textInput;
    conn.event('_tiC', { _tiV: 1, _tiD: keyboard.clearTextPayload(session) });
    if (text) conn.event('_tiC', { _tiV: 1, _tiD: keyboard.insertTextPayload(session, text) });
    if (submit) conn.event('_tiC', { _tiV: 1, _tiD: keyboard.insertTextPayload(session, '\n') });
    this.textInput.text = text;
  }

  /** Opens or closes the touch session; calls are serialized so touch events never race a start/stop. */
  _touchSession(on) {
    if (this.touchActive === on) return this.touchOp;
    this.touchActive = on;
    const conn = this.conn;
    const send = () => {
      if (on) {
        return this.tvrc
          ? conn.request('HIDTouchStart', { TouchFlags: 0, Height: TOUCH_SIZE, Width: TOUCH_SIZE })
          : conn.request('_touchStart', { _height: float(TOUCH_SIZE), _tFl: 0, _width: float(TOUCH_SIZE) });
      }
      return conn.request(this.tvrc ? 'HIDTouchStop' : '_touchStop', {});
    };
    this.touchOp = this.touchOp.catch(() => {}).then(send);
    this.touchOp.catch((err) => { this.touchActive = !on; this.emit('warning', err); });
    return this.touchOp;
  }

  close() {
    if (this.conn) { this.conn.removeAllListeners(); this.conn.close(); this.conn = null; }
    this.touchReady = false;
    this.touchActive = false;
    this.touchOp = Promise.resolve();
    this.tvrc = false;
    this.textInput = null;
  }

  _require() {
    if (!this.connected) throw new Error("Non connecté à l'Apple TV");
    return this.conn;
  }

  _onEvent(id, content) {
    if (id === '_iMC' || id === 'MediaControlStatus') {
      this.mediaFlags = content._mcF ?? content.MediaControlFlags ?? 0;
      this.emit('mediaFlags', this.mediaControls());
    } else if (id === '_tiStarted') {
      this._setTextInput(content._tiD);
    } else if (id === '_tiStopped') {
      this._setTextInput(null);
    } else if (id === 'TVSystemStatus') {
      this.emit('power', AttentionState[content.state] || 'unknown');
    } else {
      this.emit('event', id, content);
    }
  }

  mediaControls() {
    return Object.fromEntries(Object.entries(MediaFlags).map(([k, bit]) => [k, (this.mediaFlags & bit) !== 0]));
  }

  async hid(command, state) {
    const conn = this._require();
    if (ARROWS.has(command) && this.touchActive) await this._touchSession(false);
    if (this.tvrc) await conn.request('HIDCommand', { HIDCommand: command, HIDButtonState: state });
    else await conn.request('_hidC', { _hBtS: state, _hidC: command });
  }

  /** action: 'tap' | 'down' | 'up' | 'long' */
  async button(name, action = 'tap') {
    const cmd = HID[name];
    if (!cmd) throw new Error(`Touche inconnue: ${name}`);
    if (action === 'down' || action === 'up') return this.hid(cmd, ButtonState[action]);
    await this.hid(cmd, ButtonState.down);
    if (action === 'long') await new Promise((r) => setTimeout(r, 1000));
    await this.hid(cmd, ButtonState.up);
  }

  /** x, y in 0..1000; phase 'press' | 'hold' | 'release' */
  touch(x, y, phase) {
    const conn = this._require();
    if (!this.touchReady) throw new Error('Pavé tactile non disponible');
    const cx = Math.round(Math.max(0, Math.min(TOUCH_SIZE, x)));
    const cy = Math.round(Math.max(0, Math.min(TOUCH_SIZE, y)));
    const send = () => {
      const ns = Number(process.hrtime.bigint());
      // -[TVRCHIDTouchSession sendTouchEvent:completion:] sends the HIDTouch event with these keys.
      if (this.tvrc) {
        conn.event('HIDTouch', { Nanoseconds: ns, TouchFinger: 1, TouchPhase: TouchPhase[phase], CoordinateX: cx, CoordinateY: cy });
      } else {
        conn.event('_hidT', { _ns: ns, _tFg: 1, _cx: cx, _tPh: LegacyTouchPhase[phase], _cy: cy });
      }
    };
    // Arrow presses close the touch session; the next gesture reopens it before sending.
    this._touchSession(true).then(send, () => {});
  }

  async media(command, extra = {}) {
    const cmd = MediaCommand[command];
    if (!cmd) throw new Error(`Commande média inconnue: ${command}`);
    return this._require().request('_mcc', { _mcc: cmd, ...extra });
  }

  async setVolume(percent) {
    return this.media('set_volume', { _vol: float(Math.max(0, Math.min(100, percent)) / 100) });
  }

  async getVolume() {
    const res = await this.media('get_volume');
    return typeof res._vol === 'number' ? Math.round(res._vol * 100) : null;
  }

  async skip(seconds) {
    return this.media('skip_by', { _skpS: float(seconds) });
  }

  /** Request shape from -[TVRCRPCompanionLinkClientWrapper fetchLaunchableAppsWithRange:completion:]. */
  async apps() {
    const res = await this._require().request('FetchLaunchableApplicationsEvent', {
      IncludeAppMetadataKey: false, AppRangeStartingIndexKey: '0', AppRangeCountKey: '200', UsePNG: false,
    }, 10000);
    const infos = res.AppInfos && typeof res.AppInfos === 'object' ? res.AppInfos : res;
    return Object.entries(infos)
      .filter(([, name]) => typeof name === 'string')
      .map(([bundleId, name]) => ({ bundleId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async launchApp(bundleIdOrUrl) {
    const content = bundleIdOrUrl.includes('://') ? { _urlS: bundleIdOrUrl } : { _bundleID: bundleIdOrUrl };
    return this._require().request('_launchApp', content);
  }

  async powerState() {
    const res = await this._require().request('FetchAttentionState', {});
    return AttentionState[res.state] || 'unknown';
  }

  async power(on) {
    return this.button(on ? 'wake' : 'sleep');
  }

  /** TVRemoteCore-level request seen in the iOS 27 binary; response shape is logged for further RE. */
  async nowPlaying() {
    return this._require().request('FetchCurrentNowPlayingInfoEvent', {}, 5000);
  }
}

module.exports = { CompanionClient, discover, HID, MediaCommand };
