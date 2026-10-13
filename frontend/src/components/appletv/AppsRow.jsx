import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowClockwise } from '@phosphor-icons/react';

// Apps people reach for first; the rest follow alphabetically.
const PINNED = [
  'com.netflix.Netflix', 'com.google.ios.youtube', 'com.spotify.client', 'com.apple.TVWatchList',
  'tv.twitch', 'com.disney.disneyplus', 'com.plexapp.plex', 'com.amazon.aiv.AIVApp', 'com.canal.canalplus',
];
const SHOW_SYSTEM_KEY = 'remote_me_atv_show_system_apps';

function sortApps(list, pinned) {
  const rank = (id) => { const i = pinned.indexOf(id); return i === -1 ? pinned.length : i; };
  return [...list].sort((a, b) => rank(a.bundleId) - rank(b.bundleId) || a.name.localeCompare(b.name));
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function AppIcon({ app, Glyph }) {
  const [broken, setBroken] = useState(false);
  const box = 'flex aspect-square w-full items-center justify-center overflow-hidden rounded-control border border-line bg-raised transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95';
  if (app.icon && !broken) {
    return (
      <span className={box}>
        <img src={app.icon} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      </span>
    );
  }
  if (Glyph) {
    return <span className={`${box} text-muted group-hover:text-fg`}><Glyph size={34} weight="light" /></span>;
  }
  return <span className={`${box} text-lg font-semibold text-muted`}>{initials(app.name)}</span>;
}

/** Shared by both remotes; `pinned` orders favorites, `storageKey` remembers the system-apps toggle. */
export default function AppsRow({ load, onLaunch, pinned = PINNED, storageKey = SHOW_SYSTEM_KEY, glyphs = {} }) {
  const reduce = useReducedMotion();
  const [apps, setApps] = useState(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [showSystem, setShowSystem] = useState(() => localStorage.getItem(storageKey) === '1');

  useEffect(() => {
    let alive = true;
    load()
      .then((list) => { if (alive) { setApps(sortApps(list, pinned)); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [load, pinned, version]);

  function refresh() {
    setApps(null);
    setFailed(false);
    setVersion((v) => v + 1);
  }

  function toggleSystem() {
    setShowSystem((v) => {
      localStorage.setItem(storageKey, v ? '0' : '1');
      return !v;
    });
  }

  const systemCount = apps?.filter((a) => a.system).length ?? 0;
  const visible = apps?.filter((a) => showSystem || !a.system);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="apps-title">
      <div className="flex items-center gap-2 px-1">
        <h3 id="apps-title" className="section-title">Apps</h3>
        {systemCount > 0 && (
          <button
            type="button"
            onClick={toggleSystem}
            aria-pressed={showSystem}
            className={`focus-ring ml-auto rounded-full border px-3 py-1 text-xs transition-colors ${showSystem ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-muted hover:text-fg'}`}
          >
            Apps système ({systemCount})
          </button>
        )}
        <button
          type="button"
          onClick={refresh}
          aria-label="Actualiser la liste des apps"
          className={`focus-ring rounded-full p-1.5 text-faint hover:text-fg ${systemCount > 0 ? '' : 'ml-auto'}`}
        >
          <ArrowClockwise size={15} />
        </button>
      </div>

      {failed ? (
        <p className="rounded-control bg-well/50 px-4 py-4 text-sm text-muted">
          Impossible de récupérer les apps.{' '}
          <button type="button" onClick={refresh} className="focus-ring rounded text-accent underline-offset-2 hover:underline">Réessayer</button>
        </p>
      ) : (
        // Mobile: one swipeable row. Desktop: everything visible in a wrapping grid.
        <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] lg:gap-x-4 lg:gap-y-5 lg:overflow-visible lg:px-0">
          {visible === undefined
            ? Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex w-[4.75rem] shrink-0 flex-col items-center gap-2 lg:w-auto">
                <div className="aspect-square w-full animate-pulse rounded-control bg-well" />
                <div className="h-2.5 w-12 animate-pulse rounded-full bg-well/70" />
              </li>
            ))
            : visible.length === 0
              ? <li className="text-sm text-muted">Aucune app installée n'a été trouvée.</li>
              : visible.map((app, i) => (
                <motion.li
                  key={app.bundleId}
                  className="w-[4.75rem] shrink-0 snap-start lg:w-auto"
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <button
                    type="button"
                    onClick={() => onLaunch(app.bundleId)}
                    title={`Ouvrir ${app.name}`}
                    className="focus-ring group flex w-full flex-col items-center gap-2 rounded-control"
                  >
                    <AppIcon app={app} Glyph={glyphs[app.bundleId]} />
                    <span className="w-full truncate text-center text-[11px] text-muted group-hover:text-fg lg:text-xs">{app.name}</span>
                  </button>
                </motion.li>
              ))}
        </ul>
      )}
    </section>
  );
}
