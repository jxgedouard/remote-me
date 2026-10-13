'use strict';

// OPACK: Apple's compact binary serialization used by Rapport (Companion Link).
// Floats are wrapped as { __float: n } when encoding so JS numbers stay integers by default.

class OFloat {
  constructor(value) { this.value = value; }
}
const float = (v) => new OFloat(v);

function packInt(n) {
  if (n < 0x28) return Buffer.from([0x08 + n]);
  if (n <= 0xff) return Buffer.from([0x30, n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0x31; b.writeUInt16LE(n, 1); return b; }
  if (n <= 0xffffffff) { const b = Buffer.alloc(5); b[0] = 0x32; b.writeUInt32LE(n, 1); return b; }
  const b = Buffer.alloc(9); b[0] = 0x33; b.writeBigUInt64LE(BigInt(n), 1); return b;
}

function sized(base, len, sizes) {
  // sizes: [[maxLen, marker, byteCount], ...]
  for (const [max, marker, count] of sizes) {
    if (len <= max) {
      const h = Buffer.alloc(1 + count);
      h[0] = marker;
      h.writeUIntLE(len, 1, count);
      return h;
    }
  }
  throw new Error('OPACK: value too large');
}

function pack(value) {
  if (value === null || value === undefined) return Buffer.from([0x04]);
  if (value === true) return Buffer.from([0x01]);
  if (value === false) return Buffer.from([0x02]);
  if (value instanceof OFloat) {
    const b = Buffer.alloc(9); b[0] = 0x36; b.writeDoubleLE(value.value, 1); return b;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0) return packInt(value);
    const b = Buffer.alloc(9); b[0] = 0x36; b.writeDoubleLE(value, 1); return b;
  }
  if (typeof value === 'bigint') return packInt(Number(value));
  if (typeof value === 'string') {
    const s = Buffer.from(value, 'utf8');
    const h = s.length <= 0x20 ? Buffer.from([0x40 + s.length])
      : sized(0x61, s.length, [[0xff, 0x61, 1], [0xffff, 0x62, 2], [0xffffff, 0x63, 3], [0xffffffff, 0x64, 4]]);
    return Buffer.concat([h, s]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const d = Buffer.from(value);
    const h = d.length <= 0x20 ? Buffer.from([0x70 + d.length])
      : sized(0x91, d.length, [[0xff, 0x91, 1], [0xffff, 0x92, 2], [0xffffffff, 0x93, 4]]);
    return Buffer.concat([h, d]);
  }
  if (Array.isArray(value)) {
    const parts = [Buffer.from([0xd0 + Math.min(value.length, 0xf)]), ...value.map(pack)];
    if (value.length >= 0xf) parts.push(Buffer.from([0x03]));
    return Buffer.concat(parts);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const parts = [Buffer.from([0xe0 + Math.min(entries.length, 0xf)])];
    for (const [k, v] of entries) parts.push(pack(k), pack(v));
    if (entries.length >= 0xf) parts.push(Buffer.from([0x03]));
    return Buffer.concat(parts);
  }
  throw new Error(`OPACK: unsupported type ${typeof value}`);
}

function unpack(buf) {
  const objects = [];
  const keyOf = (v) => (Buffer.isBuffer(v) ? 'b:' + v.toString('hex') : 'j:' + JSON.stringify(v));

  function read(pos) {
    const t = buf[pos];
    let value, next, remember = true;

    if (t === 0x01 || t === 0x02) { value = t === 0x01; next = pos + 1; remember = false; }
    else if (t === 0x03) throw new Error('OPACK: unexpected terminator');
    else if (t === 0x04) { value = null; next = pos + 1; remember = false; }
    else if (t === 0x05) { value = buf.subarray(pos + 1, pos + 17).toString('hex'); next = pos + 17; }
    else if (t === 0x06) { value = buf.readDoubleLE(pos + 1); next = pos + 9; }
    else if (t >= 0x08 && t <= 0x2f) { value = t - 8; next = pos + 1; remember = false; }
    else if (t === 0x35) { value = buf.readFloatLE(pos + 1); next = pos + 5; }
    else if (t === 0x36) { value = buf.readDoubleLE(pos + 1); next = pos + 9; }
    else if ((t & 0xf0) === 0x30) {
      const n = 1 << (t & 0xf);
      value = n === 8 ? Number(buf.readBigUInt64LE(pos + 1)) : buf.readUIntLE(pos + 1, n);
      next = pos + 1 + n;
    }
    else if (t >= 0x40 && t <= 0x60) {
      const len = t - 0x40;
      value = buf.toString('utf8', pos + 1, pos + 1 + len); next = pos + 1 + len;
    }
    else if (t > 0x60 && t <= 0x64) {
      const n = t & 0xf, len = buf.readUIntLE(pos + 1, n);
      value = buf.toString('utf8', pos + 1 + n, pos + 1 + n + len); next = pos + 1 + n + len;
    }
    else if (t >= 0x70 && t <= 0x90) {
      const len = t - 0x70;
      value = Buffer.from(buf.subarray(pos + 1, pos + 1 + len)); next = pos + 1 + len;
    }
    else if (t >= 0x91 && t <= 0x94) {
      const n = 1 << ((t & 0xf) - 1);
      const len = n === 8 ? Number(buf.readBigUInt64LE(pos + 1)) : buf.readUIntLE(pos + 1, n);
      value = Buffer.from(buf.subarray(pos + 1 + n, pos + 1 + n + len)); next = pos + 1 + n + len;
    }
    else if (t >= 0xa0 && t <= 0xc0) { value = objects[t - 0xa0]; next = pos + 1; remember = false; }
    else if (t >= 0xc1 && t <= 0xc4) {
      const n = t - 0xc0;
      value = objects[buf.readUIntLE(pos + 1, n)]; next = pos + 1 + n; remember = false;
    }
    else if ((t & 0xf0) === 0xd0) {
      const count = t & 0xf; value = []; next = pos + 1;
      if (count === 0xf) {
        while (buf[next] !== 0x03) { const [v, n] = read(next); value.push(v); next = n; }
        next++;
      } else {
        for (let i = 0; i < count; i++) { const [v, n] = read(next); value.push(v); next = n; }
      }
    }
    else if ((t & 0xe0) === 0xe0) {
      const count = t & 0xf; value = {}; next = pos + 1;
      const readPair = () => {
        const [k, n1] = read(next); const [v, n2] = read(n1);
        value[k] = v; next = n2;
      };
      if (count === 0xf) { while (buf[next] !== 0x03) readPair(); next++; }
      else for (let i = 0; i < count; i++) readPair();
    }
    else throw new Error(`OPACK: unknown type 0x${t.toString(16)} at ${pos}`);

    if (remember && !objects.some((o) => keyOf(o) === keyOf(value))) objects.push(value);
    return [value, next];
  }

  return read(0)[0];
}

module.exports = { pack, unpack, float };
