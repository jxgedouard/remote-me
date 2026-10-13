import { motion, useReducedMotion } from 'motion/react';
import { CaretUp, CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react';

const spring = { type: 'spring', stiffness: 420, damping: 26 };

// Positioned with grid cells, not translate classes: Motion's whileTap writes `transform`
// and would wipe a Tailwind translate, making the arrows jump on click.
const ARROWS = [
  { key: 'up', label: 'Haut', Icon: CaretUp, cls: 'col-start-2 row-start-1' },
  { key: 'left', label: 'Gauche', Icon: CaretLeft, cls: 'col-start-1 row-start-2' },
  { key: 'right', label: 'Droite', Icon: CaretRight, cls: 'col-start-3 row-start-2' },
  { key: 'down', label: 'Bas', Icon: CaretDown, cls: 'col-start-2 row-start-3' },
];

/** Ring D-pad, the alternative layout offered by the iOS Control Center remote. */
export default function DPad({ onButton }) {
  const reduce = useReducedMotion();
  const tap = reduce ? undefined : { scale: 0.9 };

  return (
    <div className="mx-auto grid aspect-square w-full max-w-[18rem] grid-cols-[1fr_38%_1fr] grid-rows-[1fr_38%_1fr] place-items-center rounded-full border border-line bg-well/60 p-2">
      {ARROWS.map(({ key, label, Icon, cls }) => (
        <motion.button
          key={key}
          type="button"
          aria-label={label}
          whileTap={tap}
          transition={spring}
          onClick={() => onButton(key)}
          className={`focus-ring flex h-16 w-16 items-center justify-center rounded-full text-muted hover:text-fg ${cls}`}
        >
          <Icon size={22} weight="bold" />
        </motion.button>
      ))}
      <motion.button
        type="button"
        aria-label="Sélectionner"
        whileTap={tap}
        transition={spring}
        onClick={() => onButton('select')}
        className="focus-ring col-start-2 row-start-2 h-full w-full rounded-full border border-line bg-raised hover:bg-well"
      />
    </div>
  );
}
