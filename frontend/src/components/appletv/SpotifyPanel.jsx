import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  SpotifyLogo, SkipBack, SkipForward, Play, Pause, Copy, Check, Television, MusicNotes, MagnifyingGlass, X,
} from '@phosphor-icons/react';

const API = '/api/spotify';
const POLL_MS = 4000;
const LOGIN_HOSTS = ['localhost', '127.0.0.1'];
const SEARCH_DELAY_MS = 300;
const PLAYLISTS_SHOWN = 12;
// Mobile: swipeable row. Desktop: wrapping grid that uses the column width.
const CARD_LIST = 'no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] lg:gap-4 lg:overflow-visible lg:px-0';

async function call(path, body) {
  const res = await fetch(`${API}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-control border border-line bg-well px-3 py-2">
      <code className="min-w-0 flex-1 truncate text-xs text-muted">{value}</code>
      <button
        type="button"
        aria-label="Copier"
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="focus-ring rounded-full p-1 text-muted hover:text-fg"
      >
        {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function Setup({ status, onSaved, onError }) {
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const canLogin = LOGIN_HOSTS.includes(window.location.hostname);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { onSaved(await call('/config', { clientId })); }
    catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  if (status.configured) {
    const href = `http://127.0.0.1:3001/api/spotify/login?returnTo=${encodeURIComponent(window.location.href.split('?')[0])}`;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Connecte ton compte Spotify pour piloter la musique de l'Apple TV.</p>
        {canLogin ? (
          <a href={href} className="key h-12 self-start px-5 font-medium">
            <SpotifyLogo size={18} weight="fill" className="text-accent" />
            Se connecter à Spotify
          </a>
        ) : (
          <p className="rounded-control bg-well/50 px-4 py-3 text-sm text-muted">
            La connexion se fait une seule fois depuis le PC qui fait tourner le serveur (sur localhost:5173). Ensuite ça marche aussi ici.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted">
        <li>Crée une app sur <a className="text-accent underline-offset-2 hover:underline" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com</a> (cocher Web API).</li>
        <li>Ajoute cette Redirect URI :</li>
      </ol>
      <CopyField value={status.redirectUri} />
      <label htmlFor="spotify-client" className="text-sm font-medium text-muted">Client ID de l'app</label>
      <div className="flex gap-2">
        <input
          id="spotify-client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          spellCheck={false}
          placeholder="32 caractères"
          className="focus-ring min-w-0 flex-1 rounded-control border border-line bg-well px-4 py-3 font-mono text-sm text-fg placeholder:text-faint focus:border-accent"
        />
        <button type="submit" disabled={!clientId || busy} className="key px-5 font-medium">Valider</button>
      </div>
    </form>
  );
}

function SearchField({ value, onChange }) {
  const input = useRef(null);
  return (
    <div className="relative">
      <MagnifyingGlass size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onChange(''); }}
        placeholder="Titres, artistes, albums, playlists"
        aria-label="Rechercher sur Spotify"
        enterKeyHint="search"
        className="focus-ring w-full rounded-control border border-line bg-well py-3 pl-11 pr-11 text-sm text-fg placeholder:text-faint focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); input.current?.focus(); }}
          aria-label="Effacer la recherche"
          className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-faint hover:text-fg"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function CardSkeleton() {
  return (
    <li className="flex w-28 shrink-0 flex-col gap-2 lg:w-auto">
      <div className="aspect-square w-full animate-pulse rounded-control bg-well" />
      <div className="h-2.5 w-20 animate-pulse rounded-full bg-well/70" />
    </li>
  );
}

/** Playlist, album or artist tile; plays its context on the Apple TV. */
function Card({ item, starting, onPlay }) {
  const round = item.kind === 'artist';
  return (
    <li className="w-28 shrink-0 snap-start lg:w-auto">
      <button
        type="button"
        onClick={() => onPlay(item.uri, item.id)}
        disabled={starting !== null}
        title={`Lire ${item.name} sur l'Apple TV`}
        className="focus-ring group flex w-full flex-col gap-2 rounded-control text-left"
      >
        <span className={`relative block aspect-square w-full overflow-hidden border border-line bg-well ${round ? 'rounded-full' : 'rounded-control'}`}>
          {item.image
            ? <img src={item.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
            : <span className="flex h-full w-full items-center justify-center text-faint"><MusicNotes size={24} /></span>}
          <span className="absolute inset-0 hidden items-center justify-center bg-ink/40 opacity-0 transition-opacity group-hover:opacity-100 lg:flex">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg"><Play size={18} weight="fill" /></span>
          </span>
          {starting === item.id && (
            <span className="absolute inset-0 flex items-center justify-center bg-ink/70 text-xs text-fg">Ouverture...</span>
          )}
        </span>
        <span className="flex flex-col">
          <span className="line-clamp-2 text-xs text-fg">{item.name}</span>
          {item.subtitle && <span className="truncate text-[11px] text-faint">{item.subtitle}</span>}
        </span>
      </button>
    </li>
  );
}

function TrackRow({ track, starting, onPlay }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPlay(track.uri, track.id)}
        disabled={starting !== null}
        title={`Lire ${track.name} sur l'Apple TV`}
        className="focus-ring group flex w-full items-center gap-3 rounded-control p-1.5 text-left hover:bg-well/60"
      >
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-line bg-well">
          {track.image && <img src={track.image} alt="" loading="lazy" className="h-full w-full object-cover" />}
          <span className={`absolute inset-0 flex items-center justify-center bg-ink/60 text-fg transition-opacity ${starting === track.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <Play size={15} weight="fill" />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{track.name}</span>
          <span className="truncate text-xs text-muted">{track.subtitle}</span>
        </span>
      </button>
    </li>
  );
}

function SearchResults({ results, starting, onPlay }) {
  if (!results) {
    return (
      <ul className="grid gap-1 lg:grid-cols-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 p-1.5">
            <div className="h-11 w-11 animate-pulse rounded-xl bg-well" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-3 w-40 animate-pulse rounded-full bg-well" />
              <div className="h-2.5 w-24 animate-pulse rounded-full bg-well/70" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  const groups = [['Artistes', results.artists], ['Albums', results.albums], ['Playlists', results.playlists]]
    .filter(([, items]) => items.length);
  if (!results.tracks.length && !groups.length) return <p className="px-1 text-sm text-muted">Aucun résultat.</p>;
  return (
    <div className="flex flex-col gap-5">
      {results.tracks.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="px-1 text-xs font-medium text-muted">Titres</h4>
          <ul className="grid gap-1 lg:grid-cols-2">
            {results.tracks.map((t) => <TrackRow key={t.id} track={t} starting={starting} onPlay={onPlay} />)}
          </ul>
        </div>
      )}
      {groups.map(([label, items]) => (
        <div key={label} className="flex flex-col gap-3">
          <h4 className="px-1 text-xs font-medium text-muted">{label}</h4>
          <ul className={CARD_LIST}>
            {items.map((item) => <Card key={item.id} item={item} starting={starting} onPlay={onPlay} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The one elevated block on the Spotify side: the album art lights its own backdrop. */
function NowPlaying({ player, onControl, reduce }) {
  const track = player?.track;
  const fade = reduce ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  return (
    <div className="relative isolate overflow-hidden rounded-panel border border-line bg-surface/70">
      <AnimatePresence>
        {track?.artwork && (
          <motion.img
            key={`bg-${track.artwork}`}
            src={track.artwork}
            alt=""
            aria-hidden
            {...fade}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 -z-10 h-full w-full scale-150 object-cover opacity-40 blur-3xl saturate-150"
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-surface/40 via-surface/70 to-surface/90" aria-hidden />

      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-thumb bg-well shadow-[0_18px_36px_-18px_rgb(var(--shadow)/0.9)] lg:h-24 lg:w-24">
            <AnimatePresence mode="wait">
              {track?.artwork ? (
                <motion.img
                  key={track.artwork}
                  src={track.artwork}
                  alt={`Pochette de ${track.album || track.title}`}
                  className="h-full w-full object-cover"
                  {...fade}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-faint"><MusicNotes size={26} /></span>
              )}
            </AnimatePresence>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate text-lg font-semibold tracking-tight lg:text-xl">{track?.title || 'Rien en lecture'}</p>
            <p className="truncate text-sm text-muted">{track?.artist || 'Cherche un titre ou choisis une playlist'}</p>
            {player?.device && <p className="truncate text-xs text-faint">Sur {player.device.name}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-center">
          <button type="button" aria-label="Précédent" disabled={!player?.active} onClick={() => onControl('previous')} className="key h-11 w-11 rounded-full">
            <SkipBack size={17} weight="fill" />
          </button>
          <button
            type="button"
            aria-label={player?.playing ? 'Pause' : 'Lecture'}
            disabled={!player?.active}
            onClick={() => onControl(player?.playing ? 'pause' : 'resume')}
            className="key h-14 w-14 rounded-full border-transparent bg-accent text-accent-fg hover:bg-accent"
          >
            {player?.playing ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
          </button>
          <button type="button" aria-label="Suivant" disabled={!player?.active} onClick={() => onControl('next')} className="key h-11 w-11 rounded-full">
            <SkipForward size={17} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SpotifyPanel({ onError }) {
  const reduce = useReducedMotion();
  const [status, setStatus] = useState(null);
  const [player, setPlayer] = useState(null);
  const [lists, setLists] = useState(null);
  const [starting, setStarting] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [allLists, setAllLists] = useState(false);

  useEffect(() => {
    // Coming back from the Spotify login redirect.
    const url = new URL(window.location.href);
    if (url.searchParams.has('spotify')) {
      url.searchParams.delete('spotify');
      window.history.replaceState(null, '', url);
    }
    let alive = true;
    call('/status').then((s) => { if (alive) setStatus(s); }).catch(() => { if (alive) setStatus({ configured: false, loggedIn: false, redirectUri: '' }); });
    return () => { alive = false; };
  }, []);

  const loggedIn = !!status?.loggedIn;

  const refreshPlayer = useCallback(() => call('/player').then(setPlayer).catch(() => {}), []);

  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    call('/playlists').then((l) => { if (alive) setLists(l); }).catch((err) => { if (alive) { setLists([]); onError(err.message); } });
    const tick = () => call('/player').then((p) => { if (alive) setPlayer(p); }).catch(() => {});
    tick();
    const id = setInterval(() => { if (!document.hidden) tick(); }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [loggedIn, onError]);

  // Debounced catalog search; results are tagged with their query so stale ones show as loading.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let alive = true;
    const t = setTimeout(() => {
      call(`/search?q=${encodeURIComponent(q)}`)
        .then((r) => { if (alive) setResults({ q, ...r }); })
        .catch((err) => { if (alive) { setResults({ q, tracks: [], artists: [], albums: [], playlists: [] }); onError(err.message); } });
    }, SEARCH_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [query, onError]);

  async function control(action) {
    try { await call('/control', { action }); setTimeout(refreshPlayer, 400); }
    catch (err) { onError(err.message); }
  }

  async function playOnTV(contextUri, key) {
    setStarting(key);
    try { await call('/play-on-tv', { contextUri }); setTimeout(refreshPlayer, 800); }
    catch (err) { onError(err.message); }
    finally { setStarting(null); }
  }

  if (!status) {
    return (
      <section className="flex flex-col gap-4" aria-busy="true" aria-label="Spotify">
        <div className="flex items-center gap-2 px-1">
          <SpotifyLogo size={18} weight="fill" className="text-accent" />
          <span className="section-title">Spotify</span>
        </div>
        <div className="h-16 animate-pulse rounded-control bg-well/60" />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="spotify-title">
      <div className="flex items-center gap-2 px-1">
        <SpotifyLogo size={18} weight="fill" className="text-accent" />
        <h3 id="spotify-title" className="section-title">Spotify</h3>
        {loggedIn && (
          <button
            type="button"
            onClick={() => playOnTV(undefined, 'resume')}
            disabled={starting !== null}
            className="focus-ring ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted hover:text-fg"
          >
            <Television size={14} />
            {starting === 'resume' ? 'Ouverture...' : "Lire sur l'Apple TV"}
          </button>
        )}
      </div>

      {!loggedIn ? (
        <Setup status={status} onSaved={setStatus} onError={onError} />
      ) : (
        <>
          <NowPlaying player={player} onControl={control} reduce={reduce} />
          <SearchField value={query} onChange={setQuery} />
          {query.trim() ? (
            <SearchResults results={results?.q === query.trim() ? results : null} starting={starting} onPlay={playOnTV} />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center px-1">
                <h4 className="text-xs font-medium text-muted">Tes playlists</h4>
                {lists?.length > PLAYLISTS_SHOWN && (
                  <button type="button" onClick={() => setAllLists((v) => !v)} className="focus-ring ml-auto rounded-full px-2 py-1 text-xs text-muted hover:text-fg">
                    {allLists ? 'Réduire' : `Tout afficher (${lists.length})`}
                  </button>
                )}
              </div>
              <ul className={CARD_LIST}>
                {lists === null
                  ? Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)
                  : lists.length === 0
                    ? <li className="text-sm text-muted">Aucune playlist trouvée.</li>
                    : (allLists ? lists : lists.slice(0, PLAYLISTS_SHOWN)).map((p) => <Card key={p.id} item={{ ...p, kind: 'playlist' }} starting={starting} onPlay={playOnTV} />)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
