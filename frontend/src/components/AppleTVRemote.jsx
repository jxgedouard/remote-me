import { useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  CaretLeft, Television, PlayPause, SpeakerSimpleLow, SpeakerSimpleHigh,
  ClockCounterClockwise, ClockClockwise, Power, WarningCircle, X,
} from '@phosphor-icons/react';
import { useAppleTV } from '../hooks/useAppleTV';
import { useRemoteShortcuts } from '../hooks/useRemoteShortcuts';
import Setup from './appletv/Setup';
import TouchSurface from './appletv/TouchSurface';
import DPad from './appletv/DPad';
import AppsRow from './appletv/AppsRow';
import SpotifyPanel from './appletv/SpotifyPanel';
import TextEntry from './appletv/TextEntry';
import Reveal from './Reveal';

const LONG_PRESS_MS = 550;
const spring = { type: 'spring', stiffness: 420, damping: 26 };

/** Button with tap + long-press semantics (Home long = Control Center, Back long = top menu). */
function Key({ label, children, onTap, onLong, className = '', ...rest }) {
  const reduce = useReducedMotion();
  const timer = useRef(null);
  const longFired = useRef(false);

  function down() {
    if (!onLong) return;
    longFired.current = false;
    timer.current = setTimeout(() => { longFired.current = true; onLong(); }, LONG_PRESS_MS);
  }
  function cancel() { clearTimeout(timer.current); }
  function click() {
    cancel();
    if (longFired.current) { longFired.current = false; return; }
    onTap();
  }

  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={reduce ? undefined : { scale: 0.95 }}
      transition={spring}
      onPointerDown={down}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={click}
      className={`key h-14 ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

const POWER_LABEL = { awake: 'Allumée', idle: 'Allumée', screensaver: 'Économiseur', asleep: 'En veille', unknown: '' };

const SHORTCUTS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'select', Escape: 'menu', Backspace: 'menu', ' ': 'playpause',
  h: 'home', H: 'home', '+': 'volume_up', '=': 'volume_up', '-': 'volume_down',
};

export default function AppleTVRemote() {
  const atv = useAppleTV();
  const reduce = useReducedMotion();
  const { state, button, error, clearError } = atv;
  // Mouse/trackpad computers (Windows, Mac) start on the D-pad; touch screens on the touchpad.
  const [mode, setModeState] = useState(() => localStorage.getItem('remote_me_atv_mode')
    || (window.matchMedia('(hover: hover) and (pointer: fine)').matches ? 'dpad' : 'touch'));
  const connected = state.status === 'connected';
  const reconnecting = state.paired && ['connecting', 'disconnected'].includes(state.status);

  useRemoteShortcuts(connected, SHORTCUTS, button);

  function setMode(next) {
    setModeState(next);
    localStorage.setItem('remote_me_atv_mode', next);
  }

  if (!connected && !reconnecting) return <Setup atv={atv} />;

  const asleep = state.power === 'asleep';
  const fade = reduce ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

  // Mobile: one column, typing box first. Desktop: remote pinned on the left, content on the right.
  // The two column wrappers are `display: contents` on mobile so `order-*` can interleave their children.
  return (
    <section className="mx-auto w-full max-w-md px-4 pb-10 lg:max-w-[1400px] lg:px-8" aria-label="Télécommande Apple TV">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="contents lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4">
          <Reveal className="slab order-2 flex flex-col gap-5 p-5 lg:p-7">
            <header className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="truncate text-base font-semibold tracking-tight">{state.device?.name || 'Apple TV'}</h2>
                <p className="text-xs text-muted" aria-live="polite">
                  {reconnecting ? 'Reconnexion...' : POWER_LABEL[state.power] || 'Connectée'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => atv.power(asleep).catch(() => {})}
                disabled={!connected}
                aria-label={asleep ? "Allumer l'Apple TV" : "Mettre l'Apple TV en veille"}
                aria-pressed={!asleep}
                className={`key h-11 w-11 rounded-full ${asleep ? '' : 'border-accent/40 text-accent'}`}
              >
                <Power size={18} weight="bold" />
              </button>
            </header>

            <div role="tablist" aria-label="Mode de navigation" className="grid grid-cols-2 rounded-full border border-line bg-well/50 p-1">
              {[['touch', 'Pavé tactile'], ['dpad', 'Flèches']].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => setMode(id)}
                  className="focus-ring relative rounded-full py-2 text-sm font-medium"
                >
                  {mode === id && (
                    <motion.span layoutId="atv-mode" transition={spring} className="absolute inset-0 rounded-full bg-raised" />
                  )}
                  <span className={`relative ${mode === id ? 'text-fg' : 'text-muted'}`}>{label}</span>
                </button>
              ))}
            </div>

            <div className={reconnecting ? 'pointer-events-none opacity-50' : ''} aria-disabled={reconnecting}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={mode} {...fade} transition={{ duration: 0.18 }}>
                  {mode === 'touch'
                    ? <TouchSurface touchEnabled={state.touch} onTouch={atv.touch} onButton={button} />
                    : <DPad onButton={button} />}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Key label="Retour (maintenir : menu principal)" onTap={() => button('menu')} onLong={() => button('menu', 'long')}>
                <CaretLeft size={20} weight="bold" />
              </Key>
              <Key label="TV (maintenir : centre de contrôle)" onTap={() => button('home')} onLong={() => button('home', 'long')}>
                <Television size={20} />
              </Key>
              <Key label="Lecture / pause" onTap={() => button('playpause')}>
                <PlayPause size={20} weight="fill" />
              </Key>
            </div>

            <div className="grid grid-cols-4 gap-2.5">
              <Key label="Reculer de 10 secondes" onTap={() => atv.media({ skip: -10 }).catch(() => {})}>
                <ClockCounterClockwise size={19} />
              </Key>
              <Key label="Baisser le volume" onTap={() => button('volume_down')}>
                <SpeakerSimpleLow size={19} />
              </Key>
              <Key label="Monter le volume" onTap={() => button('volume_up')}>
                <SpeakerSimpleHigh size={19} />
              </Key>
              <Key label="Avancer de 10 secondes" onTap={() => atv.media({ skip: 10 }).catch(() => {})}>
                <ClockClockwise size={19} />
              </Key>
            </div>
          </Reveal>

          <div className="order-5 flex items-start justify-between gap-4 px-1">
            <p className="hidden text-xs leading-relaxed text-faint lg:block">
              Clavier : flèches, Entrée pour valider, Échap pour revenir, Espace pour lecture/pause, H pour l'accueil.
            </p>
            <button
              type="button"
              onClick={() => atv.forget().catch(() => {})}
              className="focus-ring shrink-0 rounded-full text-xs text-faint hover:text-danger"
            >
              Oublier cette Apple TV
            </button>
          </div>
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-12 lg:pt-2">
          <AnimatePresence>
            {connected && state.keyboard?.active && (
              <TextEntry key="keyboard" className="order-1" keyboard={state.keyboard} onText={atv.text} onButton={button} />
            )}
          </AnimatePresence>

          {connected && (
            <Reveal index={1} className="order-3 pt-6 lg:pt-0">
              <AppsRow load={atv.apps} onLaunch={(id) => atv.launch(id).catch(() => {})} />
            </Reveal>
          )}

          <Reveal index={2} className="order-4 pt-6 lg:pt-0">
            <SpotifyPanel onError={atv.reportError} />
          </Reveal>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            role="alert"
            {...(reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 12 } })}
            className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-toast mx-auto flex max-w-md items-start gap-2 rounded-control border border-danger/30 bg-surface px-4 py-3 text-sm text-fg shadow-2xl lg:left-auto lg:right-8 lg:mx-0 lg:w-96"
          >
            <WarningCircle size={18} className="mt-px shrink-0 text-danger" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={clearError} aria-label="Fermer" className="focus-ring rounded-full text-muted hover:text-fg">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
