'use strict';

const crypto = require('crypto');
const { SRP, SrpClient } = require('fast-srp-hap');
const opack = require('./opack');
const { Tlv, encode, decode } = require('./tlv8');
const c = require('./crypto');
const { FrameType } = require('./connection');

function checkError(tlv, step) {
  if (tlv[Tlv.Error]) {
    const code = tlv[Tlv.Error][0];
    const reasons = { 2: 'PIN incorrect', 3: 'trop de tentatives, réessaie plus tard', 4: 'appareil inconnu', 5: 'pairing déjà en cours', 6: 'occupé' };
    throw new Error(`Pairing refusé (${step}): ${reasons[code] || 'code ' + code}`);
  }
}

const pd = (obj) => {
  if (!obj || !Buffer.isBuffer(obj._pd)) throw new Error('Réponse de pairing invalide');
  return decode(obj._pd);
};

/**
 * Pair-setup, step 1: asks the Apple TV to display a PIN.
 * Returns a function that finishes pairing with that PIN and resolves to credentials.
 */
async function pairSetupStart(conn, deviceName) {
  const m2 = pd(await conn.exchangeFrame(FrameType.PS_Start, {
    _pd: encode([[Tlv.Method, 0x00], [Tlv.State, 0x01]]),
    _pwTy: 1,
  }));
  checkError(m2, 'M2');
  const salt = m2[Tlv.Salt];
  const serverPub = m2[Tlv.PublicKey];

  return async function finish(pin) {
    const srp = new SrpClient(SRP.params.hap, salt, Buffer.from('Pair-Setup'), Buffer.from(String(pin)), crypto.randomBytes(32));
    srp.setB(serverPub);

    const m4 = pd(await conn.exchangeFrame(FrameType.PS_Next, {
      _pd: encode([[Tlv.State, 0x03], [Tlv.PublicKey, srp.computeA()], [Tlv.Proof, srp.computeM1()]]),
      _pwTy: 1,
    }));
    checkError(m4, 'M4');
    srp.checkM2(m4[Tlv.Proof]);
    const K = srp.computeK();

    const clientId = Buffer.from(crypto.randomUUID().toUpperCase());
    const { seed, publicKey } = c.ed25519Generate();
    const deviceX = c.hkdf(K, 'Pair-Setup-Controller-Sign-Salt', 'Pair-Setup-Controller-Sign-Info');
    const signature = c.ed25519Sign(seed, Buffer.concat([deviceX, clientId, publicKey]));
    const info = opack.pack({
      altIRK: crypto.randomBytes(16),
      accountID: crypto.randomUUID().toUpperCase(),
      model: 'iPhone17,1',
      wifiMAC: crypto.randomBytes(6),
      name: deviceName,
      mac: crypto.randomBytes(6),
    });
    const sub = encode([[Tlv.Identifier, clientId], [Tlv.PublicKey, publicKey], [Tlv.Signature, signature], [Tlv.Name, info]]);
    const sessionKey = c.hkdf(K, 'Pair-Setup-Encrypt-Salt', 'Pair-Setup-Encrypt-Info');

    const m6 = pd(await conn.exchangeFrame(FrameType.PS_Next, {
      _pd: encode([[Tlv.State, 0x05], [Tlv.EncryptedData, c.seal(sessionKey, c.labelNonce('PS-Msg05'), sub)]]),
      _pwTy: 1,
    }));
    checkError(m6, 'M6');
    const accessory = decode(c.open(sessionKey, c.labelNonce('PS-Msg06'), m6[Tlv.EncryptedData]));

    return {
      clientId: clientId.toString('utf8'),
      seed: seed.toString('hex'),
      atvId: accessory[Tlv.Identifier].toString('utf8'),
      atvLtpk: accessory[Tlv.PublicKey].toString('hex'),
    };
  };
}

/** Pair-verify with stored credentials; enables session encryption on success. */
async function pairVerify(conn, creds) {
  const eph = c.x25519Generate();
  const m2 = pd(await conn.exchangeFrame(FrameType.PV_Start, {
    _pd: encode([[Tlv.State, 0x01], [Tlv.PublicKey, eph.publicKey]]),
    _auTy: 4,
  }, 10000));
  checkError(m2, 'verify M2');

  const atvEph = m2[Tlv.PublicKey];
  const shared = c.x25519Shared(eph.priv, atvEph);
  const verifyKey = c.hkdf(shared, 'Pair-Verify-Encrypt-Salt', 'Pair-Verify-Encrypt-Info');
  const inner = decode(c.open(verifyKey, c.labelNonce('PV-Msg02'), m2[Tlv.EncryptedData]));

  const atvId = inner[Tlv.Identifier];
  const ok = c.ed25519Verify(Buffer.from(creds.atvLtpk, 'hex'),
    Buffer.concat([atvEph, atvId, eph.publicKey]), inner[Tlv.Signature]);
  if (!ok) throw new Error("Signature de l'Apple TV invalide — refais le pairing");

  const clientId = Buffer.from(creds.clientId);
  const sig = c.ed25519Sign(Buffer.from(creds.seed, 'hex'), Buffer.concat([eph.publicKey, clientId, atvEph]));
  const sub = encode([[Tlv.Identifier, clientId], [Tlv.Signature, sig]]);

  const m4 = pd(await conn.exchangeFrame(FrameType.PV_Next, {
    _pd: encode([[Tlv.State, 0x03], [Tlv.EncryptedData, c.seal(verifyKey, c.labelNonce('PV-Msg03'), sub)]]),
  }, 10000));
  checkError(m4, 'verify M4');

  conn.enableEncryption(new c.SessionCipher(
    c.hkdf(shared, '', 'ClientEncrypt-main'),
    c.hkdf(shared, '', 'ServerEncrypt-main'),
  ));
}

module.exports = { pairSetupStart, pairVerify };
