'use strict';

const express = require('express');
const router = express.Router();
const atv = require('../services/appleTVService');

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/appletv/discover — Apple TVs advertising _companion-link._tcp
router.get('/discover', handle(() => atv.discover()));

// GET /api/appletv/state
router.get('/state', handle(() => atv.getState()));

// POST /api/appletv/connect  { ip?, port? }
router.post('/connect', handle((req) => atv.connect(req.body.ip, req.body.port)));

// POST /api/appletv/pair/start — the Apple TV shows a 4-digit PIN
router.post('/pair/start', handle(() => atv.startPairing()));

// POST /api/appletv/pair/finish  { pin }
router.post('/pair/finish', handle((req) => {
  if (!req.body.pin) throw new Error('pin required');
  return atv.submitPin(req.body.pin);
}));

// POST /api/appletv/forget
router.post('/forget', handle(() => { atv.forget(); return atv.getState(); }));

// POST /api/appletv/button  { key, action?: tap|down|up|long }
router.post('/button', handle(async (req) => {
  await atv.button(req.body.key, req.body.action);
  return { status: 'ok' };
}));

// POST /api/appletv/media  { command } | { skip: seconds } | { volume: 0..100 }
router.post('/media', handle(async (req) => {
  const { command, skip, volume } = req.body;
  if (typeof skip === 'number') await atv.skip(skip);
  else if (typeof volume === 'number') await atv.setVolume(volume);
  else await atv.media(command);
  return { status: 'ok' };
}));

// POST /api/appletv/power  { on: boolean }
router.post('/power', handle(async (req) => {
  await atv.power(!!req.body.on);
  return atv.getState();
}));

// GET /api/appletv/apps
router.get('/apps', handle(() => atv.apps()));

// POST /api/appletv/launch  { bundleId }
router.post('/launch', handle(async (req) => {
  await atv.launchApp(req.body.bundleId);
  return { status: 'ok' };
}));

// POST /api/appletv/text  { text, submit? } — types into the text field focused on the Apple TV
router.post('/text', handle(async (req) => {
  await atv.setText(String(req.body.text ?? ''), { submit: !!req.body.submit });
  return { status: 'ok' };
}));

// GET /api/appletv/nowplaying — experimental TVRemoteCore request
router.get('/nowplaying', handle(() => atv.nowPlaying()));

// POST /api/appletv/disconnect
router.post('/disconnect', handle(() => { atv.disconnect(); return atv.getState(); }));

module.exports = router;
