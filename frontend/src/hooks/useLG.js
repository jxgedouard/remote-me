import { useCallback, useEffect, useMemo, useState } from 'react';
import { socket } from '../lib/socket';

const API = '/api/lgtv';

async function request(path, body) {
  const res = await fetch(`${API}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

const INITIAL = { status: 'idle', ip: null, model: null, power: 'unknown', app: null, soundOutput: null, volume: null, muted: false, error: null };

export function useLG() {
  const [state, setState] = useState(INITIAL);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onState = (s) => setState(s);
    socket.on('lg:state', onState);
    request('/state').then(setState).catch(() => {});
    return () => socket.off('lg:state', onState);
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  /** Pointer-socket button name: UP, DOWN, LEFT, RIGHT, ENTER, BACK, HOME, EXIT, MENU... */
  const button = useCallback((key) => {
    socket.emit('lg:button', { key }, (res) => { if (res?.error) setError(res.error); });
  }, []);

  const run = useCallback(async (fn) => {
    setError(null);
    try { return await fn(); }
    catch (err) { setError(err.message); throw err; }
  }, []);

  // Stable references so components can list them as effect dependencies.
  const actions = useMemo(() => ({
    clearError: () => setError(null),
    connect: (ip) => run(() => request('/connect', { ip })),
    forget: () => run(() => request('/forget', {})),
    power: (on) => run(() => request('/power', { on })),
    apps: () => request('/apps'),
    inputs: () => request('/inputs'),
    launch: (id) => run(() => request('/launch', { id })),
    input: (id) => run(() => request('/input', { id })),
    settings: (section) => run(() => request('/settings', { section })),
    soundOutput: (output) => run(() => request('/sound-output', { output })),
    mute: (mute) => run(() => request('/volume', { mute })),
    volume: (volume) => run(() => request('/volume', { volume })),
    text: (text, submit = false) => run(() => request('/text', { text, submit })),
  }), [run]);

  return { state, error, button, ...actions };
}
