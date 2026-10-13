'use strict';

const express = require('express');
const router = express.Router();
const lg = require('../services/lgTVService');

const handle = (fn) => async (req, res) => {
  try {
    res.json((await fn(req)) ?? { status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/lgtv/state
router.get('/state', handle(() => lg.getState()));

// GET /api/lgtv/capabilities — what this TV accepts (settings sections, sound outputs)
router.get('/capabilities', handle(() => ({ settingsSections: lg.settingsSections, soundOutputs: lg.soundOutputs })));

// POST /api/lgtv/connect  { ip } — first time, accept the prompt on the TV
router.post('/connect', handle((req) => {
  if (!req.body.ip) throw new Error('Adresse IP requise');
  return lg.connect(String(req.body.ip).trim());
}));

// POST /api/lgtv/forget
router.post('/forget', handle(() => { lg.forget(); return lg.getState(); }));

// POST /api/lgtv/button  { key } — pointer-socket button name (UP, ENTER, HOME, MENU...)
router.post('/button', handle((req) => lg.button(req.body.key)));

// POST /api/lgtv/power  { on }
router.post('/power', handle((req) => (req.body.on ? lg.powerOn() : lg.powerOff())));

// GET /api/lgtv/apps
router.get('/apps', handle(() => lg.apps()));

// POST /api/lgtv/launch  { id }
router.post('/launch', handle((req) => lg.launch(req.body.id)));

// GET /api/lgtv/inputs
router.get('/inputs', handle(() => lg.inputs()));

// POST /api/lgtv/input  { id } — HDMI_1, HDMI_2...
router.post('/input', handle((req) => lg.switchInput(req.body.id)));

// POST /api/lgtv/settings  { section? } — opens the TV settings, optionally on a section
router.post('/settings', handle((req) => lg.openSettings(req.body.section)));

// POST /api/lgtv/sound-output  { output }
router.post('/sound-output', handle((req) => lg.setSoundOutput(req.body.output)));

// POST /api/lgtv/volume  { volume } | { mute }
router.post('/volume', handle((req) => (typeof req.body.mute === 'boolean' ? lg.setMute(req.body.mute) : lg.setVolume(Number(req.body.volume)))));

// POST /api/lgtv/media  { action: play|pause|stop|rewind|fastForward }
router.post('/media', handle((req) => lg.media(req.body.action)));

// POST /api/lgtv/text  { text, submit? } — types into the TV's on-screen keyboard
router.post('/text', handle((req) => lg.text(String(req.body.text ?? ''), { submit: !!req.body.submit })));

// POST /api/lgtv/toast  { message }
router.post('/toast', handle((req) => lg.toast(String(req.body.message || ''))));

module.exports = router;
