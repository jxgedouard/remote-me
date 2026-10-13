import { useCallback, useEffect, useMemo, useState } from 'react';
import { socket } from '../lib/socket';

const API = '/api/appletv';

async function request(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

const INITIAL = { status: 'idle', paired: false, device: null, power: 'unknown', media: null, touch: false, keyboard: { active: false }, error: null };

export function useAppleTV() {
  const [state, setState] = useState(INITIAL);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onState = (s) => setState(s);
    const onError = (msg) => setError(msg);
    socket.on('atv:state', onState);
    socket.on('atv:error', onError);
    request('/state', { method: 'GET' }).then(setState).catch(() => {});
    return () => {
      socket.off('atv:state', onState);
      socket.off('atv:error', onError);
    };
  }, []);

  // Transient errors fade on their own; the user can also dismiss them.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const run = useCallback(async (fn) => {
    setError(null);
    try { return await fn(); }
    catch (err) { setError(err.message); throw err; }
  }, []);

  /** action: 'tap' | 'down' | 'up' | 'long' */
  const button = useCallback((key, action = 'tap') => {
    socket.emit('atv:button', { key, action }, (res) => {
      if (res?.error) setError(res.error);
    });
  }, []);

  /** Fire-and-forget: called from pointer handlers, never from React state. */
  const touch = useCallback((x, y, phase) => {
    socket.emit('atv:touch', { x, y, phase });
  }, []);

  /** Replaces the text of the field focused on the Apple TV; submit also sends Return. */
  const text = useCallback((value, submit = false) => {
    socket.emit('atv:text', { text: value, submit }, (res) => {
      if (res?.error) setError(res.error);
    });
  }, []);

  // Stable references so components can safely list them as effect dependencies.
  const actions = useMemo(() => ({
    clearError: () => setError(null),
    reportError: (message) => setError(message),
    discover: () => request('/discover', { method: 'GET' }),
    connect: (ip, port) => run(() => request('/connect', { body: { ip, port } })),
    startPairing: () => run(() => request('/pair/start')),
    submitPin: (pin) => run(() => request('/pair/finish', { body: { pin } })),
    forget: () => run(() => request('/forget')),
    media: (body) => run(() => request('/media', { body })),
    power: (on) => run(() => request('/power', { body: { on } })),
    apps: () => request('/apps', { method: 'GET' }),
    launch: (bundleId) => run(() => request('/launch', { body: { bundleId } })),
  }), [run]);

  return { state, error, button, touch, text, ...actions };
}
