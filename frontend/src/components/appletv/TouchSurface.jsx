import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useMotionTemplate, useReducedMotion } from 'motion/react';

const SIZE = 1000; // Touch area negotiated with _touchStart
const TAP_MAX_MS = 260;
const TAP_MAX_TRAVEL = 0.035; // fraction of the surface
const SWIPE_STEP = 0.18; // fallback: one arrow per 18% of travel

/**
 * Clickpad-style surface, like the Siri Remote / Control Center remote.
 * Sends raw _hidT touch events when the Apple TV granted a touch session,
 * otherwise converts swipes into arrow presses. A quick tap is Select.
 */
export default function TouchSurface({ touchEnabled, onTouch, onButton }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const gesture = useRef(null);
  const frame = useRef(0);

  const x = useMotionValue(50);
  const y = useMotionValue(50);
  const springX = useSpring(x, { stiffness: 500, damping: 40 });
  const springY = useSpring(y, { stiffness: 500, damping: 40 });
  const opacity = useSpring(0, { stiffness: 300, damping: 30 });
  const left = useMotionTemplate`${springX}%`;
  const top = useMotionTemplate`${springY}%`;

  function point(e) {
    const r = ref.current.getBoundingClientRect();
    return {
      fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e) {
    ref.current.setPointerCapture(e.pointerId);
    const { fx, fy } = point(e);
    gesture.current = { startX: fx, startY: fy, lastX: fx, lastY: fy, anchorX: fx, anchorY: fy, t: performance.now(), travel: 0 };
    x.jump(fx * 100); y.jump(fy * 100); springX.jump(fx * 100); springY.jump(fy * 100);
    opacity.set(1);
    if (touchEnabled) onTouch(fx * SIZE, fy * SIZE, 'press');
  }

  function onPointerMove(e) {
    const g = gesture.current;
    if (!g) return;
    const { fx, fy } = point(e);
    g.travel = Math.max(g.travel, Math.hypot(fx - g.startX, fy - g.startY));
    g.lastX = fx; g.lastY = fy;
    x.set(fx * 100); y.set(fy * 100);

    if (touchEnabled) {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const cur = gesture.current;
        if (cur) onTouch(cur.lastX * SIZE, cur.lastY * SIZE, 'hold');
      });
      return;
    }

    const dx = fx - g.anchorX, dy = fy - g.anchorY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_STEP) {
      onButton(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      g.anchorX = fx; g.anchorY = fy;
    }
  }

  function end(e) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    opacity.set(0);
    if (touchEnabled) onTouch(g.lastX * SIZE, g.lastY * SIZE, 'release');
    if (e.type === 'pointerup' && performance.now() - g.t < TAP_MAX_MS && g.travel < TAP_MAX_TRAVEL) onButton('select');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onButton('select'); }
  }

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label="Pavé tactile. Glisse pour naviguer, touche pour sélectionner."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className="focus-ring relative aspect-square max-h-[44dvh] w-full cursor-pointer touch-none select-none overflow-hidden rounded-panel border border-line bg-well/60"
    >
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 blur-2xl"
          style={{ left, top, opacity }}
        />
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-faint">
        {touchEnabled ? 'Glisse ou touche' : 'Glisse pour naviguer, touche pour valider'}
      </span>
    </div>
  );
}
