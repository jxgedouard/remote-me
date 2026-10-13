import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Power, ArrowUUpLeft, House, X, GearSix, SlidersHorizontal, Info, SpeakerSimpleLow, SpeakerSimpleHigh,
  SpeakerSimpleSlash, Rewind, Play, Pause, FastForward, Image, SpeakerHigh, ListBullets, WifiHigh,
  PersonArmsSpread, Plug, Bluetooth, Headphones, WarningCircle, PaperPlaneRight, ArrowElbowDownLeft,
  ArrowClockwise, TelevisionSimple, ArrowSquareOut, Broadcast, Globe, MusicNotes, Images, Screencast, FilmStrip,
  ListDashes, Television,
} from '@phosphor-icons/react';
import { useLG } from '../hooks/useLG';
import { useRemoteShortcuts } from '../hooks/useRemoteShortcuts';
import DPad from './appletv/DPad';
import AppsRow from './appletv/AppsRow';
import VolumeSlider from './lg/VolumeSlider';
import Reveal from './Reveal';

const spring = { type: 'spring', stiffness: 420, damping: 26 };

const SHORTCUTS = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'ENTER',
  Escape: 'BACK', Backspace: 'BACK', h: 'HOME', H: 'HOME', m: 'MENU', M: 'MENU', i: 'INFO', I: 'INFO',
  '+': 'VOLUMEUP', '=': 'VOLUMEUP', '-': 'VOLUMEDOWN',
};
const DPAD_KEYS = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', select: 'ENTER' };

// The six sections webOS 3 opens directly (verified on the TV; other targets fall back to Picture).
const SECTIONS = [
  { id: 'picture', label: 'Image', hint: 'Mode d’image, lumière OLED, contraste, couleurs', Icon: Image },
  { id: 'sound', label: 'Son', hint: 'Mode son, sortie audio, synchro AV', Icon: SpeakerHigh },
  { id: 'general', label: 'Général', hint: 'Langue, heure, économie d’énergie, mises à jour', Icon: GearSix },
  { id: 'network', label: 'Réseau', hint: 'Wi-Fi, nom de la TV, allumage via Wi-Fi', Icon: WifiHigh },
  { id: 'channel', label: 'Chaînes', hint: 'Recherche et gestion des chaînes', Icon: ListBullets },
  { id: 'accessibility', label: 'Accessibilité', hint: 'Sous-titres, contraste élevé, audiodescription', Icon: PersonArmsSpread },
];

// Grid placement + surface per bento cell (mobile: 2 columns, desktop: 4 x 3).
const BENTO = {
  picture: 'col-span-2 min-h-[11rem] lg:row-span-2 lg:min-h-0 bg-[radial-gradient(120%_90%_at_0%_0%,rgb(var(--accent)/0.22),transparent_60%)]',
  sound: 'col-span-2 bg-[linear-gradient(135deg,rgb(var(--fg)/0.06),transparent_70%)]',
  general: '',
  network: '',
  channel: 'lg:col-span-2',
  accessibility: 'lg:col-span-2',
};

const SOUND_OUTPUTS = [
  { id: 'tv_speaker', label: 'TV', Icon: SpeakerSimpleHigh },
  { id: 'external_speaker', label: 'Optique', Icon: Plug },
  { id: 'external_arc', label: 'HDMI ARC', Icon: Plug },
  { id: 'bt_soundbar', label: 'Bluetooth', Icon: Bluetooth },
  { id: 'headphone', label: 'Casque', Icon: Headphones },
];

// Built-in apps have no store artwork: give them a glyph instead of bare initials.
const GLYPHS = {
  'com.iptvsmarters.app': Broadcast, 'channelplus.eu': TelevisionSimple, 'com.webos.app.livetv': Television,
  'com.webos.app.tvguide': ListDashes, 'com.webos.app.music': MusicNotes, 'com.webos.app.browser': Globe,
  'com.webos.app.photovideo': Images, 'com.webos.app.miracast': Screencast, ui30: FilmStrip,
};

// Apps reached for first on this TV; everything else is alphabetical.
const PINNED = ['netflix', 'youtube.leanback.v4', 'amazon.global', 'com.disney.disneyplus-prod', 'cdp-30', 'spotify-beehive', 'com.iptvsmarters.app'];

function Btn({ label, onPress, children, className = '', active = false }) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={reduce ? undefined : { scale: 0.95 }}
      transition={spring}
      onClick={onPress}
      className={`key h-14 ${active ? 'border-accent/40 text-accent' : ''} ${className}`}
    >
      {children}
    </motion.button>
  );
}

/** Open section on the content side: a heading and its content, no card around it. */
function Panel({ title, action, children, className = '', index = 0 }) {
  return (
    <Reveal as="section" index={index} className={`flex flex-col gap-4 pt-6 lg:pt-0 ${className}`} aria-label={title}>
      <div className="flex items-center gap-2 px-1">
        <h3 className="section-title">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </Reveal>
  );
}

/** Pairing / unreachable screens. */
function Setup({ lg }) {
  const { state, error } = lg;
  const [ip, setIp] = useState(state.ip || '');
  const [busy, setBusy] = useState(false);
  const known = !!state.ip;

  async function act(fn) {
    setBusy(true);
    try { await fn(); } catch { /* surfaced via lg.error */ } finally { setBusy(false); }
  }

  let body;
  if (state.status === 'prompt') {
    body = (
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Accepte la demande sur la TV</h2>
        <p className="text-sm text-muted">Une fenêtre d'autorisation s'affiche sur la LG. Valide-la avec la télécommande, une seule fois.</p>
      </div>
    );
  } else if (state.status === 'connecting') {
    body = (
      <div className="flex flex-col gap-3" aria-busy="true">
        <h2 className="text-lg font-semibold tracking-tight">Connexion à la TV LG...</h2>
        <div className="h-3 w-48 animate-pulse rounded-full bg-well" />
      </div>
    );
  } else if (known) {
    body = (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight">TV éteinte ou injoignable</h2>
          <p className="text-sm text-muted">
            {state.model ? `${state.model} - ` : ''}{state.ip}. La reconnexion se fait toute seule dès qu'elle s'allume.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => act(() => lg.power(true))} className="key h-12 px-5 font-medium text-accent">
            <Power size={18} weight="bold" /> Allumer
          </button>
          <button type="button" disabled={busy} onClick={() => act(() => lg.connect(state.ip))} className="key h-12 px-5 font-medium">
            <ArrowClockwise size={18} /> Réessayer
          </button>
        </div>
        <p className="text-xs text-faint">
          L'allumage à distance demande l'option « Allumer via Wi-Fi » (Paramètres, Réseau) sur la TV.
        </p>
        <button type="button" onClick={() => act(lg.forget)} className="focus-ring self-start rounded-full text-xs text-faint hover:text-danger">
          Oublier cette TV
        </button>
      </div>
    );
  } else {
    body = (
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (ip) act(() => lg.connect(ip.trim())); }}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight">Connecte ta TV LG</h2>
          <p className="text-sm text-muted">La TV doit être allumée et sur le même Wi-Fi. La première fois, elle demande une autorisation.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="lg-ip" className="text-sm font-medium text-muted">Adresse IP de la TV</label>
          <div className="flex gap-2">
            <input
              id="lg-ip"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              inputMode="decimal"
              placeholder="192.168.1.43"
              className="focus-ring min-w-0 flex-1 rounded-control border border-line bg-well px-4 py-3 text-fg placeholder:text-faint focus:border-accent"
            />
            <button type="submit" disabled={!ip || busy} className="key px-5 font-medium">Connecter</button>
          </div>
          <p className="text-xs text-faint">Sur la TV : Paramètres, Réseau, puis la connexion active.</p>
        </div>
      </form>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-10" aria-label="Connexion TV LG">
      <div className="panel flex flex-col gap-6 p-6">
        {body}
        {(error || state.error) && (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">
            <WarningCircle size={18} className="mt-px shrink-0" />
            <span>{error || state.error}</span>
          </p>
        )}
      </div>
    </section>
  );
}

function SettingsPanel({ lg, className }) {
  const { state } = lg;
  return (
    <Panel
      index={1}
      title="Paramètres de la TV"
      className={className}
      action={(
        <button type="button" onClick={() => lg.settings().catch(() => {})} className="focus-ring flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted hover:text-fg">
          <ArrowSquareOut size={14} /> Tous les réglages
        </button>
      )}
    >
      {/* Bento: 6 sections, 6 cells. Picture is the one people open most, so it gets the big tile. */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:grid-rows-[repeat(3,minmax(6.5rem,auto))]">
        {SECTIONS.map(({ id, label, hint, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => lg.settings(id).catch(() => {})}
            className={`key group relative isolate h-auto flex-col items-start justify-end gap-1 overflow-hidden p-4 text-left ${BENTO[id]}`}
          >
            <Icon
              size={id === 'picture' ? 44 : 22}
              weight={id === 'picture' ? 'light' : 'regular'}
              className={`mb-auto transition-transform duration-300 group-hover:-translate-y-0.5 ${id === 'picture' || id === 'sound' ? 'text-accent' : 'text-muted group-hover:text-fg'}`}
            />
            <span className={`pt-6 font-semibold tracking-tight ${id === 'picture' ? 'text-2xl' : 'text-sm'}`}>{label}</span>
            <span className={`text-xs text-muted ${id === 'picture' ? 'max-w-[26ch]' : 'line-clamp-2'}`}>{hint}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="px-1 text-xs font-medium text-muted">Sortie son</h4>
        <div role="radiogroup" aria-label="Sortie son" className="grid grid-cols-5 gap-1 rounded-full border border-line bg-well/50 p-1">
          {SOUND_OUTPUTS.map(({ id, label, Icon }) => {
            const active = state.soundOutput === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                onClick={() => lg.soundOutput(id).catch(() => {})}
                className="focus-ring relative flex items-center justify-center gap-1.5 rounded-full py-2 text-xs font-medium"
              >
                {active && <motion.span layoutId="lg-sound" transition={spring} className="absolute inset-0 rounded-full bg-raised" />}
                <Icon size={14} className={`relative ${active ? 'text-accent' : 'text-muted'}`} />
                <span className={`relative hidden sm:inline ${active ? 'text-fg' : 'text-muted'}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="px-1 text-xs leading-relaxed text-faint">
        Ce modèle (webOS 3.0) ne laisse pas lire ni régler ses paramètres à distance : chaque carte ouvre directement la page sur la TV, à piloter avec les flèches.
      </p>
    </Panel>
  );
}

function InputsPanel({ inputs, current, onSelect, className }) {
  const shown = inputs?.filter((i) => i.id.startsWith('HDMI') || i.connected);
  return (
    <Panel index={2} title="Entrées" className={className}>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {shown === undefined
          ? Array.from({ length: 4 }, (_, i) => <li key={i} className="h-16 animate-pulse rounded-control bg-well/60" />)
          : shown.map((input) => {
            const active = current === input.appId;
            return (
              <li key={input.id}>
                <button
                  type="button"
                  onClick={() => onSelect(input.id)}
                  aria-pressed={active}
                  className={`key h-16 w-full flex-col items-start justify-center gap-0.5 px-4 text-left ${active ? 'border-accent/50 bg-accent-soft' : ''}`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${input.connected ? 'bg-accent' : 'bg-faint/50'}`} aria-hidden />
                    <span className="truncate text-sm font-medium">{input.label}</span>
                  </span>
                  <span className="pl-3.5 text-[11px] text-muted">{input.id.replace('_', ' ')}{input.connected ? '' : ' - rien de branché'}</span>
                </button>
              </li>
            );
          })}
      </ul>
    </Panel>
  );
}

function TextPanel({ onSend, className }) {
  const [value, setValue] = useState('');
  function send(submit) {
    onSend(value, submit).catch(() => {});
  }
  return (
    <Panel index={4} title="Écrire sur la TV" className={className}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(true); }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ouvre un champ de recherche sur la TV, puis tape ici"
          aria-label="Texte à envoyer à la TV"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          className="focus-ring min-w-0 flex-1 rounded-control border border-line bg-well px-4 py-3 text-sm text-fg placeholder:text-faint focus:border-accent"
        />
        <button type="button" onClick={() => send(false)} aria-label="Envoyer le texte" className="key w-12 shrink-0">
          <PaperPlaneRight size={18} />
        </button>
        <button type="submit" aria-label="Envoyer et valider" className="key w-12 shrink-0 text-accent">
          <ArrowElbowDownLeft size={18} weight="bold" />
        </button>
      </form>
    </Panel>
  );
}

export default function LGRemote() {
  const lg = useLG();
  const reduce = useReducedMotion();
  const { state, button, error, clearError } = lg;
  const connected = state.status === 'connected';
  const [inputs, setInputs] = useState(undefined);

  useRemoteShortcuts(connected, SHORTCUTS, button);
  const dpad = useCallback((key) => button(DPAD_KEYS[key]), [button]);

  const { inputs: loadInputs } = lg;
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    loadInputs().then((l) => { if (alive) setInputs(l); }).catch(() => { if (alive) setInputs([]); });
    return () => { alive = false; };
  }, [connected, loadInputs]);

  // AppsRow speaks the Apple TV shape ({ bundleId, name }).
  const { apps } = lg;
  const loadApps = useCallback(() => apps().then((list) => list.map((a) => ({
    bundleId: a.id, name: a.title, icon: a.icon, system: a.system,
  }))), [apps]);

  if (!connected) return <Setup lg={lg} />;

  const source = inputs?.find((i) => i.appId === state.app);
  const external = state.volume === null;

  return (
    <section className="mx-auto w-full max-w-md px-4 pb-10 lg:max-w-[1400px] lg:px-8" aria-label="Télécommande TV LG">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="contents lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4">
          <Reveal className="slab order-1 flex flex-col gap-5 p-5 lg:p-7">
            <header className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="truncate text-base font-semibold tracking-tight">LG {state.model?.replace(/-.*$/, '') || 'TV'}</h2>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted" aria-live="polite">
                  <TelevisionSimple size={12} />
                  {source ? `Entrée : ${source.label}` : state.app === 'com.palm.app.settings' ? 'Paramètres' : 'Allumée'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => lg.power(false).catch(() => {})}
                aria-label="Éteindre la TV"
                className="key h-11 w-11 rounded-full border-accent/40 text-accent"
              >
                <Power size={18} weight="bold" />
              </button>
            </header>

            <DPad onButton={dpad} />

            <div className="grid grid-cols-3 gap-2.5">
              <Btn label="Retour" onPress={() => button('BACK')}><ArrowUUpLeft size={20} weight="bold" /></Btn>
              <Btn label="Accueil" onPress={() => button('HOME')}><House size={20} /></Btn>
              <Btn label="Quitter" onPress={() => button('EXIT')}><X size={20} weight="bold" /></Btn>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Btn label="Menu rapide" onPress={() => button('MENU')} className="text-sm"><SlidersHorizontal size={18} /> Menu</Btn>
              <Btn label="Paramètres" onPress={() => lg.settings().catch(() => {})} className="text-sm"><GearSix size={18} /> Réglages</Btn>
              <Btn label="Infos" onPress={() => button('INFO')} className="text-sm"><Info size={18} /> Infos</Btn>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Btn label="Baisser le volume" onPress={() => button('VOLUMEDOWN')}><SpeakerSimpleLow size={19} /></Btn>
              <Btn label={state.muted ? 'Rétablir le son' : 'Couper le son'} active={state.muted} onPress={() => lg.mute(!state.muted).catch(() => {})}>
                <SpeakerSimpleSlash size={19} />
              </Btn>
              <Btn label="Monter le volume" onPress={() => button('VOLUMEUP')}><SpeakerSimpleHigh size={19} /></Btn>
            </div>
            {external ? (
              <p className="-mt-2 px-1 text-xs text-faint">Le son sort sur une enceinte externe : son volume se règle sur l'enceinte.</p>
            ) : (
              <VolumeSlider
                volume={state.volume}
                muted={state.muted}
                onChange={(v) => lg.volume(v).catch(() => {})}
                onMute={() => lg.mute(!state.muted).catch(() => {})}
              />
            )}

            <div className="grid grid-cols-4 gap-2.5">
              <Btn label="Retour rapide" onPress={() => button('REWIND')}><Rewind size={18} weight="fill" /></Btn>
              <Btn label="Lecture" onPress={() => button('PLAY')}><Play size={18} weight="fill" /></Btn>
              <Btn label="Pause" onPress={() => button('PAUSE')}><Pause size={18} weight="fill" /></Btn>
              <Btn label="Avance rapide" onPress={() => button('FASTFORWARD')}><FastForward size={18} weight="fill" /></Btn>
            </div>

            <div className="grid grid-cols-4 gap-2.5" aria-label="Touches de couleur">
              {[['RED', 'Rouge', 'bg-[#e5484d]'], ['GREEN', 'Vert', 'bg-[#46a758]'], ['YELLOW', 'Jaune', 'bg-[#f5d90a]'], ['BLUE', 'Bleu', 'bg-[#3e7bfa]']].map(([key, label, color]) => (
                <Btn key={key} label={`Touche ${label.toLowerCase()}`} onPress={() => button(key)} className="h-10">
                  <span className={`h-2 w-8 rounded-full ${color}`} />
                </Btn>
              ))}
            </div>
          </Reveal>

          <div className="order-6 flex items-start justify-between gap-4 px-1">
            <p className="hidden text-xs leading-relaxed text-faint lg:block">
              Clavier : flèches, Entrée pour valider, Échap pour revenir, H accueil, M menu rapide, I infos.
            </p>
            <button type="button" onClick={() => lg.forget().catch(() => {})} className="focus-ring shrink-0 rounded-full text-xs text-faint hover:text-danger">
              Oublier cette TV
            </button>
          </div>
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-12 lg:pt-2">
          <SettingsPanel lg={lg} className="order-2" />
          <InputsPanel inputs={inputs} current={state.app} onSelect={(id) => lg.input(id).catch(() => {})} className="order-3" />
          <Reveal index={3} className="order-4 pt-6 lg:pt-0">
            <AppsRow load={loadApps} pinned={PINNED} glyphs={GLYPHS} storageKey="remote_me_lg_show_system_apps" onLaunch={(id) => lg.launch(id).catch(() => {})} />
          </Reveal>
          <TextPanel onSend={lg.text} className="order-5" />
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
