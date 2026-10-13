'use strict';

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const opack = require('./opack');

// Frame types observed in Rapport.framework (PS_Start, PV_Start, U_OPACK, E_OPACK...).
const FrameType = {
  NoOp: 1, PS_Start: 3, PS_Next: 4, PV_Start: 5, PV_Next: 6, U_OPACK: 7, E_OPACK: 8, P_OPACK: 9,
};
const MessageType = { Event: 1, Request: 2, Response: 3 };
const TAG_LEN = 16;

class CompanionConnection extends EventEmitter {
  constructor(host, port) {
    super();
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.cipher = null;
    this.xid = crypto.randomInt(0x10000, 0x7fffffff);
    this.pending = new Map(); // xid -> { resolve, reject, timer }
    this.framePending = []; // FIFO of waiters for pairing frames
  }

  open(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Connexion TCP impossible vers ${this.host}:${this.port}`)); }, timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); socket.setNoDelay(true); this.socket = socket; resolve(); });
      socket.once('error', (err) => { clearTimeout(timer); reject(err); });
      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', () => this._onClose());
      socket.on('error', (err) => this.emit('error', err));
    });
  }

  close() {
    if (this.socket) this.socket.destroy();
  }

  get connected() { return !!this.socket && !this.socket.destroyed; }

  enableEncryption(cipher) { this.cipher = cipher; }

  sendFrame(type, payload) {
    if (!this.connected) throw new Error('Connexion Companion fermée');
    let body = payload;
    const len = this.cipher && payload.length > 0 ? payload.length + TAG_LEN : payload.length;
    const header = Buffer.from([type, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    if (this.cipher && payload.length > 0) body = this.cipher.encrypt(payload, header);
    this.socket.write(Buffer.concat([header, body]));
  }

  // Pairing frames: send one, wait for the next PS/PV frame from the device.
  exchangeFrame(type, obj, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.framePending = this.framePending.filter((w) => w.resolve !== resolve);
        reject(new Error("L'Apple TV n'a pas répondu (pairing)"));
      }, timeoutMs);
      this.framePending.push({ resolve: (v) => { clearTimeout(timer); resolve(v); }, reject });
      this.sendFrame(type, opack.pack(obj));
    });
  }

  request(identifier, content = {}, timeoutMs = 8000) {
    const xid = this.xid++;
    const msg = { _i: identifier, _t: MessageType.Request, _c: content, _x: xid };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(xid);
        reject(new Error(`Pas de réponse à ${identifier}`));
      }, timeoutMs);
      this.pending.set(xid, { resolve, reject, timer, identifier });
      this.sendFrame(FrameType.E_OPACK, opack.pack(msg));
    });
  }

  event(identifier, content = {}) {
    const msg = { _i: identifier, _t: MessageType.Event, _c: content, _x: this.xid++ };
    this.sendFrame(FrameType.E_OPACK, opack.pack(msg));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUIntBE(1, 3);
      if (this.buffer.length < 4 + len) break;
      const header = this.buffer.subarray(0, 4);
      let payload = this.buffer.subarray(4, 4 + len);
      const type = header[0];
      this.buffer = this.buffer.subarray(4 + len);
      try {
        if (this.cipher && payload.length > 0 && type === FrameType.E_OPACK) {
          payload = this.cipher.decrypt(payload, Buffer.from(header));
        }
        this._onFrame(type, payload);
      } catch (err) {
        this.emit('error', new Error(`Trame illisible (type ${type}): ${err.message}`));
      }
    }
  }

  _onFrame(type, payload) {
    if (type === FrameType.NoOp) return;
    const obj = payload.length ? opack.unpack(payload) : {};

    if ([FrameType.PS_Next, FrameType.PV_Next, FrameType.PS_Start, FrameType.PV_Start].includes(type)) {
      const waiter = this.framePending.shift();
      if (waiter) waiter.resolve(obj);
      return;
    }

    if (type !== FrameType.E_OPACK && type !== FrameType.U_OPACK) return;

    if (obj._t === MessageType.Response) {
      const p = this.pending.get(obj._x);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(obj._x);
      if (obj._em || obj._ec) p.reject(new Error(`${p.identifier}: ${obj._em || 'erreur ' + obj._ec}`));
      else p.resolve(obj._c || {});
    } else if (obj._t === MessageType.Event) {
      this.emit('event', obj._i, obj._c || {});
    } else if (obj._t === MessageType.Request) {
      this.emit('request', obj._i, obj._c || {}, obj._x);
    }
  }

  _onClose() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Connexion fermée')); }
    this.pending.clear();
    for (const w of this.framePending) w.reject(new Error('Connexion fermée'));
    this.framePending = [];
    this.socket = null;
    this.cipher = null;
    this.emit('close');
  }
}

module.exports = { CompanionConnection, FrameType, MessageType };
