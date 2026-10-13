import { motion, useReducedMotion } from 'motion/react';
import { AppleLogo, Television } from '@phosphor-icons/react';

const DEVICES = [
  { id: 'appletv', label: 'Apple TV', Icon: AppleLogo },
  { id: 'lgtv', label: 'TV LG', Icon: Television },
];

export default function DeviceSelector({ activeDevice, onSelect }) {
  const reduce = useReducedMotion();

  return (
    <div role="tablist" aria-label="Appareil" className="grid grid-cols-2 rounded-full border border-line bg-surface p-1">
      {DEVICES.map(({ id, label, Icon }) => {
        const active = activeDevice === id;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(id)}
            className="focus-ring relative flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium"
          >
            {active && (
              <motion.span
                layoutId="device-tab"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 30 }}
                className="absolute inset-0 rounded-full bg-raised"
              />
            )}
            <Icon size={16} weight={active ? 'fill' : 'regular'} className={`relative ${active ? 'text-accent' : 'text-muted'}`} />
            <span className={`relative ${active ? 'text-fg' : 'text-muted'}`}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
