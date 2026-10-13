'use strict';

// Remote keyboard (RTI) payloads. The Apple TV describes the focused text field as an
// NSKeyedArchiver binary plist in `_tiD`; text is sent back as an archived RTITextOperations.
// Object layout follows what the iOS remote sends (same shape pyatv uses).

const bplistParser = require('bplist-parser');
const bplistCreator = require('bplist-creator');

const isUid = (v) => v !== null && typeof v === 'object' && typeof v.UID === 'number';

/** Resolves an NSKeyedArchiver graph into plain values (NSUUID -> Buffer, NSString -> string). */
function unarchive(buffer) {
  const [root] = bplistParser.parseBuffer(buffer);
  const objects = root.$objects || [];
  const seen = new Map();

  function resolve(v) {
    if (isUid(v)) {
      if (seen.has(v.UID)) return seen.get(v.UID);
      const raw = objects[v.UID];
      if (raw === '$null') return null;
      const out = (raw && typeof raw === 'object' && !Buffer.isBuffer(raw) && !Array.isArray(raw)) ? {} : raw;
      seen.set(v.UID, out);
      if (out !== raw) Object.assign(out, decode(raw));
      return seen.get(v.UID);
    }
    if (Array.isArray(v)) return v.map(resolve);
    return v;
  }

  function decode(obj) {
    if (obj['NS.uuidbytes']) return { uuid: obj['NS.uuidbytes'] };
    if (typeof obj['NS.string'] === 'string') return { string: obj['NS.string'] };
    if (obj['NS.keys'] && obj['NS.objects']) {
      const keys = obj['NS.keys'].map(resolve);
      const vals = obj['NS.objects'].map(resolve);
      return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
    }
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (k !== '$class') out[k] = resolve(v);
    return out;
  }

  const top = {};
  for (const [k, v] of Object.entries(root.$top || {})) top[k] = resolve(v);
  return top;
}

const str = (v) => (typeof v === 'string' ? v : v && typeof v.string === 'string' ? v.string : undefined);

/** Extracts what the UI needs from a `_tiD` blob: session id, current text, field title. */
function parseTextInput(tiD) {
  const top = unarchive(tiD);
  const session = top.sessionUUID?.uuid || top.sessionUUID;
  const doc = top.documentState?.docSt || top.documentState || {};
  const traits = top.documentTraits || {};
  const text = (str(doc.contextBeforeInput) || '') + (str(doc.selectedText) || '') + (str(doc.contextAfterInput) || '');
  const title = str(traits.title) || str(traits.prompt) || str(traits.placeholder) || '';
  return { session: Buffer.isBuffer(session) ? session : null, text, title };
}

const cls = (name) => ({ $classname: name, $classes: [name, 'NSObject'] });
const UID = (n) => ({ UID: n });

function archive(objects) {
  return bplistCreator({ $version: 100000, $archiver: 'RTIKeyedArchiver', $top: { textOperations: UID(1) }, $objects: objects });
}

function clearTextPayload(session) {
  return archive([
    '$null',
    { $class: UID(7), targetSessionUUID: UID(5), keyboardOutput: UID(2), textToAssert: UID(4) },
    { $class: UID(3) },
    cls('TIKeyboardOutput'),
    '',
    { 'NS.uuidbytes': session, $class: UID(6) },
    cls('NSUUID'),
    cls('RTITextOperations'),
  ]);
}

function insertTextPayload(session, text) {
  return archive([
    '$null',
    { keyboardOutput: UID(2), $class: UID(7), targetSessionUUID: UID(5) },
    { insertionText: UID(3), $class: UID(6) },
    text,
    { 'NS.uuidbytes': session, $class: UID(4) },
    cls('NSUUID'),
    cls('TIKeyboardOutput'),
    cls('RTITextOperations'),
  ]);
}

module.exports = { parseTextInput, clearTextPayload, insertTextPayload, unarchive };
