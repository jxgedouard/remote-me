import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { TelevisionSimple, ArrowClockwise, CaretRight, WarningCircle } from '@phosphor-icons/react';

const MODEL_NAMES = {
  'AppleTV14,1': 'Apple TV 4K (3e génération)',
  'AppleTV11,1': 'Apple TV 4K (2e génération)',
  'AppleTV6,2': 'Apple TV 4K',
  'AppleTV5,3': 'Apple TV HD',
};

function DeviceSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-control bg-well/50 px-4 py-4">
      <div className="h-10 w-10 animate-pulse rounded-xl bg-well" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3 w-32 animate-pulse rounded-full bg-well" />
        <div className="h-2.5 w-44 animate-pulse rounded-full bg-well/70" />
      </div>
    </div>
  );
}

function PinEntry({ onSubmit, onCancel, busy }) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const refs = useRef([]);

  useEffect(() => { refs.current[0]?.focus(); }, []);

  function update(i, value) {
    const v = value.replace(/\D/g, '');
    if (v.length > 1) {
      // Pasted a full PIN.
      const next = v.slice(0, 4).split('');
      while (next.length < 4) next.push('');
      setDigits(next);
      if (next.every(Boolean)) onSubmit(next.join(''));
      return;
    }
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 3) refs.current[i + 1]?.focus();
    if (next.every(Boolean)) onSubmit(next.join(''));
  }

  function onKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">Saisis le code affiché sur la TV</h2>
        <p className="text-sm text-muted">L'Apple TV montre un code à 4 chiffres. Il expire après quelques minutes.</p>
      </div>
      <fieldset className="flex gap-3" disabled={busy}>
        <legend className="sr-only">Code de jumelage</legend>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={d}
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`Chiffre ${i + 1}`}
            className="focus-ring h-16 w-14 rounded-control border border-line bg-well text-center text-2xl font-semibold tabular-nums text-fg focus:border-accent"
          />
        ))}
      </fieldset>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted" aria-live="polite">{busy ? 'Vérification du code...' : ''}</span>
        <button type="button" onClick={onCancel} className="focus-ring ml-auto rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg">
          Annuler
        </button>
      </div>
    </div>
  );
}

export default function Setup({ atv }) {
  const reduce = useReducedMotion();
  const [devices, setDevices] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [scanId, setScanId] = useState(0);
  const [manualIp, setManualIp] = useState('');
  const [busy, setBusy] = useState(false);
  const { state, error } = atv;
  const pairing = state.status === 'pairing';
  const needsPairing = state.status === 'needs_pairing';

  const { discover } = atv;
  useEffect(() => {
    let alive = true;
    discover()
      .then((list) => { if (alive) setDevices(list); })
      .catch(() => { if (alive) setDevices([]); })
      .finally(() => { if (alive) setScanning(false); });
    return () => { alive = false; };
  }, [discover, scanId]);

  function scan() {
    setScanning(true);
    setScanId((n) => n + 1);
  }

  async function choose(ip, port) {
    setBusy(true);
    try {
      const s = await atv.connect(ip, port);
      if (s.status === 'needs_pairing') await atv.startPairing();
    } catch { /* surfaced via atv.error */ }
    finally { setBusy(false); }
  }

  async function submitPin(pin) {
    setBusy(true);
    try { await atv.submitPin(pin); }
    catch { /* surfaced via atv.error */ }
    finally { setBusy(false); }
  }

  const enter = reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-10" aria-labelledby="setup-title">
      <div className="panel flex flex-col gap-6 p-6">
        <AnimatePresence mode="wait">
          {pairing ? (
            <motion.div key="pin" {...enter}>
              <PinEntry busy={busy} onSubmit={submitPin} onCancel={() => atv.connect(state.device?.address, state.device?.port)} />
            </motion.div>
          ) : (
            <motion.div key="list" className="flex flex-col gap-5" {...enter}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <h2 id="setup-title" className="text-lg font-semibold tracking-tight">Choisis ton Apple TV</h2>
                  <p className="text-sm text-muted">Recherche sur le réseau local. La première connexion demande un code.</p>
                </div>
                <button
                  type="button"
                  onClick={scan}
                  disabled={scanning}
                  aria-label="Relancer la recherche"
                  className="key h-11 w-11 shrink-0"
                >
                  <ArrowClockwise size={18} className={scanning && !reduce ? 'animate-spin' : ''} />
                </button>
              </div>

              <ul className="flex flex-col gap-2" aria-busy={scanning}>
                {devices === null || (scanning && !devices?.length) ? (
                  <><li><DeviceSkeleton /></li><li><DeviceSkeleton /></li></>
                ) : devices.length === 0 ? (
                  <li className="rounded-control bg-well/50 px-4 py-5 text-sm text-muted">
                    Aucune Apple TV trouvée. Vérifie qu'elle est allumée et sur le même Wi-Fi, ou saisis son adresse IP plus bas.
                  </li>
                ) : devices.map((d) => (
                  <li key={d.address}>
                    <button
                      type="button"
                      onClick={() => choose(d.address, d.port)}
                      disabled={busy}
                      className="key w-full justify-start px-4 py-3.5 text-left"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                        <TelevisionSimple size={20} weight="fill" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">{d.name}</span>
                        <span className="truncate text-xs text-muted">{MODEL_NAMES[d.model] || d.model} - {d.address}</span>
                      </span>
                      <CaretRight size={16} className="text-faint" />
                    </button>
                  </li>
                ))}
              </ul>

              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => { e.preventDefault(); if (manualIp) choose(manualIp.trim()); }}
              >
                <label htmlFor="manual-ip" className="text-sm font-medium text-muted">Adresse IP (si elle n'apparaît pas)</label>
                <div className="flex gap-2">
                  <input
                    id="manual-ip"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    inputMode="decimal"
                    placeholder="192.168.1.42"
                    className="focus-ring min-w-0 flex-1 rounded-control border border-line bg-well px-4 py-3 text-fg placeholder:text-faint focus:border-accent"
                  />
                  <button type="submit" disabled={!manualIp || busy} className="key px-5 font-medium">
                    Connecter
                  </button>
                </div>
                <p className="text-xs text-faint">Sur l'Apple TV : Réglages, Réseau, puis la connexion active.</p>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {(error || (needsPairing && !busy && state.error)) && (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">
            <WarningCircle size={18} className="mt-px shrink-0" />
            <span>{error || state.error}</span>
          </p>
        )}
      </div>
    </section>
  );
}
