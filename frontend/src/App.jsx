import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import DeviceSelector from './components/DeviceSelector';
import AppleTVRemote from './components/AppleTVRemote';
import LGRemote from './components/LGRemote';
import { useSocket } from './hooks/useSocket';

export default function App() {
  const [activeDevice, setActiveDevice] = useState(() => localStorage.getItem('remote_me_device') || 'appletv');
  const { socketConnected } = useSocket();
  const reduce = useReducedMotion();

  function select(id) {
    setActiveDevice(id);
    localStorage.setItem('remote_me_device', id);
  }

  return (
    <div className="ambient flex min-h-[100dvh] w-full flex-col">
      <div className="grain" aria-hidden />
      <a href="#remote" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-full focus:bg-raised focus:px-4 focus:py-2">
        Aller à la télécommande
      </a>

      {/* Mobile: stacked title + full-width switcher. Desktop: one bar across the page. */}
      <header className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-4 pt-[max(2.5rem,env(safe-area-inset-top))] lg:max-w-[1400px] lg:flex-row lg:items-center lg:gap-6 lg:px-8 lg:pb-6 lg:pt-6">
        <div className="flex items-end justify-between px-1 lg:items-center lg:gap-4 lg:px-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tighter">
            <span className="h-6 w-4 rounded-[6px] border-2 border-fg/80 p-[3px]" aria-hidden>
              <span className="block h-1.5 w-full rounded-full bg-accent" />
            </span>
            Remote
          </h1>
          {!socketConnected && (
            <p role="status" className="rounded-full bg-danger-soft px-3 py-1 text-xs font-medium text-danger">
              Serveur injoignable
            </p>
          )}
        </div>
        <div className="lg:ml-auto lg:w-80">
          <DeviceSelector activeDevice={activeDevice} onSelect={select} />
        </div>
      </header>

      <main id="remote" className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeDevice}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeDevice === 'appletv' ? <AppleTVRemote /> : <LGRemote />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
