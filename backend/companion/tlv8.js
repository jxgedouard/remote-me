'use strict';

// HAP TLV8 (values > 255 bytes are split into consecutive fragments of the same type).
const Tlv = {
  Method: 0x00, Identifier: 0x01, Salt: 0x02, PublicKey: 0x03, Proof: 0x04,
  EncryptedData: 0x05, State: 0x06, Error: 0x07, BackOff: 0x08, Signature: 0x0a, Name: 0x11, Flags: 0x13,
};

function encode(entries) {
  const out = [];
  for (const [type, raw] of entries) {
    const value = Buffer.isBuffer(raw) ? raw : Buffer.from([raw]);
    if (value.length === 0) { out.push(Buffer.from([type, 0])); continue; }
    for (let i = 0; i < value.length; i += 255) {
      const chunk = value.subarray(i, i + 255);
      out.push(Buffer.from([type, chunk.length]), chunk);
    }
  }
  return Buffer.concat(out);
}

function decode(buf) {
  const map = {};
  let i = 0, last = -1;
  while (i + 2 <= buf.length) {
    const type = buf[i], len = buf[i + 1];
    const value = buf.subarray(i + 2, i + 2 + len);
    map[type] = type === last && map[type] ? Buffer.concat([map[type], value]) : Buffer.from(value);
    last = type;
    i += 2 + len;
  }
  return map;
}

module.exports = { Tlv, encode, decode };
