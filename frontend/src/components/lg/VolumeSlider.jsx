import { useEffect, useRef, useState } from 'react';
import { SpeakerSimpleNone, SpeakerSimpleHigh, SpeakerSimpleSlash } from '@phosphor-icons/react';

const SEND_EVERY_MS = 150;

/**
 * TV volume, 0-100. Sends while dragging (throttled) and once more on release; follows the
 * live value from the TV otherwise, so the physical remote moves it too.
 */
export default function VolumeSlider({ volume, muted, onChange, onMute }) {
  const [draft, setDraft] = useState(null);
  const last = useRef(0);
  const pending = useRef(null);
  const value = draft ?? volume ?? 0;

  useEffect(() => () => clearTimeout(pending.current), []);

  function input(e) {
    const v = Number(e.target.value);
    setDraft(v);
    clearTimeout(pending.current);
    const wait = SEND_EVERY_MS - (Date.now() - last.current);
    if (wait <= 0) { last.current = Date.now(); onChange(v); }
    else pending.current = setTimeout(() => { last.current = Date.now(); onChange(v); }, wait);
  }

  function commit() {
    if (draft === null) return;
    clearTimeout(pending.current);
    onChange(draft);
    setDraft(null);
  }

  return (
    <div className="flex items-center gap-3 rounded-control border border-line bg-well/50 px-3 py-2">
      <button
        type="button"
        onClick={onMute}
        aria-label={muted ? 'Rétablir le son' : 'Couper le son'}
        aria-pressed={muted}
        className={`focus-ring rounded-full p-1.5 ${muted ? 'text-accent' : 'text-muted hover:text-fg'}`}
      >
        {muted ? <SpeakerSimpleSlash size={18} /> : value === 0 ? <SpeakerSimpleNone size={18} /> : <SpeakerSimpleHigh size={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={input}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="Volume de la TV"
        aria-valuetext={`${value} sur 100`}
        style={{ '--fill': `${value}%` }}
        className={`volume-range min-w-0 flex-1 ${muted ? 'opacity-50' : ''}`}
      />
      <span className="w-8 text-right text-sm tabular-nums text-muted" aria-hidden>{value}</span>
    </div>
  );
}
