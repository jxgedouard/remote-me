'use strict';

const crypto = require('crypto');

// Raw 32-byte keys <-> Node KeyObjects via fixed DER prefixes.
const DER = {
  ed25519Priv: Buffer.from('302e020100300506032b657004220420', 'hex'),
  ed25519Pub: Buffer.from('302a300506032b6570032100', 'hex'),
  x25519Priv: Buffer.from('302e020100300506032b656e04220420', 'hex'),
  x25519Pub: Buffer.from('302a300506032b656e032100', 'hex'),
};

const privKey = (prefix, raw) =>
  crypto.createPrivateKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'pkcs8' });
const pubKey = (prefix, raw) =>
  crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
const rawPub = (keyObject) => keyObject.export({ format: 'der', type: 'spki' }).subarray(-32);

function ed25519Generate() {
  const seed = crypto.randomBytes(32);
  return { seed, publicKey: rawPub(crypto.createPublicKey(privKey(DER.ed25519Priv, seed))) };
}
const ed25519PublicFromSeed = (seed) => rawPub(crypto.createPublicKey(privKey(DER.ed25519Priv, seed)));
const ed25519Sign = (seed, data) => crypto.sign(null, data, privKey(DER.ed25519Priv, seed));
const ed25519Verify = (pub, data, sig) => crypto.verify(null, data, pubKey(DER.ed25519Pub, pub), sig);

function x25519Generate() {
  const priv = crypto.randomBytes(32);
  return { priv, publicKey: rawPub(crypto.createPublicKey(privKey(DER.x25519Priv, priv))) };
}
const x25519Shared = (priv, peerPub) =>
  crypto.diffieHellman({ privateKey: privKey(DER.x25519Priv, priv), publicKey: pubKey(DER.x25519Pub, peerPub) });

const hkdf = (ikm, salt, info, len = 32) =>
  Buffer.from(crypto.hkdfSync('sha512', ikm, Buffer.from(salt), Buffer.from(info), len));

// Pairing nonces are 4 zero bytes followed by an 8-char label (e.g. "PS-Msg05").
const labelNonce = (label) => Buffer.concat([Buffer.alloc(4), Buffer.from(label)]);

function seal(key, nonce, plaintext, aad) {
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  if (aad) c.setAAD(aad, { plaintextLength: plaintext.length });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

function open(key, nonce, sealed, aad) {
  const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  const body = sealed.subarray(0, sealed.length - 16);
  if (aad) d.setAAD(aad, { plaintextLength: body.length });
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(body), d.final()]);
}

// Session cipher: 96-bit little-endian counter nonce per direction.
class SessionCipher {
  constructor(outKey, inKey) {
    this.outKey = outKey; this.inKey = inKey;
    this.outCounter = 0n; this.inCounter = 0n;
  }
  static nonce(counter) {
    const n = Buffer.alloc(12);
    n.writeBigUInt64LE(counter, 0);
    return n;
  }
  encrypt(plaintext, aad) { return seal(this.outKey, SessionCipher.nonce(this.outCounter++), plaintext, aad); }
  decrypt(sealed, aad) { return open(this.inKey, SessionCipher.nonce(this.inCounter++), sealed, aad); }
}

module.exports = {
  ed25519Generate, ed25519PublicFromSeed, ed25519Sign, ed25519Verify,
  x25519Generate, x25519Shared, hkdf, labelNonce, seal, open, SessionCipher,
};
