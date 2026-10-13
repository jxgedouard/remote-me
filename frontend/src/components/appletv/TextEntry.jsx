import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Keyboard, ArrowElbowDownLeft } from '@phosphor-icons/react';

const SEND_DELAY_MS = 120;
const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * Shown while a text field is focused on the Apple TV (Spotify search, YouTube, logins...).
 * Typing mirrors the field live, like the iOS remote keyboard. Enter sends Return, then hands
 * the arrow keys back to the TV; Up/Down jump straight to the results.
 */
export default function TextEntry({ keyboard, onText, onButton, className = '' }) {
  const reduce = useReducedMotion();
  const input = useRef(null);
  const timer = useRef(null);
  const [value, setValue] = useState(keyboard.text || '');

  // A newly focused field on the TV: take its current text and grab the keyboard on computers.
  const fieldKey = keyboard.title || '';
  useEffect(() => {
    setValue(keyboard.text || '');
    if (finePointer()) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(e) {
    const next = e.target.value;
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onText(next), SEND_DELAY_MS);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer.current);
      onText(value, true);
      input.current?.blur();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      input.current?.blur();
      onButton(e.key === 'ArrowDown' ? 'down' : 'up');
    } else if (e.key === 'Escape') {
      input.current?.blur();
    }
  }

  return (
    <motion.section
      aria-labelledby="atv-keyboard-title"
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`panel flex flex-col gap-3 border-accent/30 p-5 lg:p-6 ${className}`}
    >
      <div className="flex items-center gap-2 px-1">
        <Keyboard size={18} weight="fill" className="text-accent" />
        <h3 id="atv-keyboard-title" className="text-sm font-semibold">Saisie sur la TV</h3>
        <span className="ml-auto hidden text-xs text-faint lg:inline">Entrée pour valider, ↓ pour aller aux résultats</span>
      </div>
      <div className="flex gap-2">
        <input
          ref={input}
          value={value}
          onChange={change}
          onKeyDown={onKeyDown}
          placeholder={keyboard.title || 'Tape ton texte'}
          aria-label={keyboard.title || 'Texte à envoyer'}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="focus-ring min-w-0 flex-1 rounded-control border border-line bg-well px-4 py-3.5 text-base text-fg placeholder:text-faint focus:border-accent"
        />
        <button
          type="button"
          onClick={() => { clearTimeout(timer.current); onText(value, true); }}
          aria-label="Valider sur la TV"
          className="key w-14 shrink-0 text-accent"
        >
          <ArrowElbowDownLeft size={20} weight="bold" />
        </button>
      </div>
    </motion.section>
  );
}
