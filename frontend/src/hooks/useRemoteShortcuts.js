import { useEffect } from 'react';

/**
 * Global keyboard control for computers: `map` turns KeyboardEvent.key into a remote key.
 * Ignored while typing in a field, with modifiers held, and for Enter/Space on a focused
 * button (the button handles its own activation).
 */
export function useRemoteShortcuts(enabled, map, press) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e) {
      const t = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if ((e.key === 'Enter' || e.key === ' ') && t instanceof HTMLElement && t.closest('button, [role="button"]')) return;
      const key = map[e.key];
      if (!key) return;
      e.preventDefault();
      press(key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, map, press]);
}
