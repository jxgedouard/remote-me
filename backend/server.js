'use strict';

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const atv = require('./services/appleTVService');
const lg = require('./services/lgTVService');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/appletv', require('./routes/appletv'));
app.use('/api/lgtv', require('./routes/lgtv'));
app.use('/api/spotify', require('./routes/spotify'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Production: serve the built interface from the same port, so phones only need http://<pc-ip>:3001.
// In development Vite serves it on :5173 and proxies /api and /socket.io here.
const WEB_DIR = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  app.use(express.static(WEB_DIR, { maxAge: '1h' }));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
}

// Socket.io — live Apple TV state out, low-latency input in
io.on('connection', (socket) => {
  console.log('[Socket.io] client connected:', socket.id);
  socket.emit('atv:state', atv.getState());
  socket.emit('lg:state', lg.getState());

  socket.on('atv:button', async ({ key, action } = {}, ack) => {
    try { await atv.button(key, action); ack?.({ ok: true }); }
    catch (err) { ack?.({ error: err.message }); }
  });

  socket.on('atv:touch', ({ x, y, phase } = {}) => {
    try { atv.touch(x, y, phase); }
    catch (err) { socket.emit('atv:error', err.message); }
  });

  socket.on('atv:text', async ({ text, submit } = {}, ack) => {
    try { await atv.setText(String(text ?? ''), { submit: !!submit }); ack?.({ ok: true }); }
    catch (err) { ack?.({ error: err.message }); }
  });

  socket.on('lg:button', async ({ key } = {}, ack) => {
    try { await lg.button(key); ack?.({ ok: true }); }
    catch (err) { ack?.({ error: err.message }); }
  });

  socket.on('disconnect', () => {
    console.log('[Socket.io] client disconnected:', socket.id);
  });
});

atv.events.on('state', (state) => io.emit('atv:state', state));
lg.events.on('state', (state) => io.emit('lg:state', state));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`remote_me running on http://localhost:${PORT}${fs.existsSync(WEB_DIR) ? '' : ' (API only: run "npm run build" for the interface)'}`);
  atv.autoConnect();
  lg.autoConnect();
});
