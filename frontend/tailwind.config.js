/** @type {import('tailwindcss').Config} */

// Colors are CSS variables (RGB channels, see src/index.css) so the same classes work in the
// dark and light themes, which follow the system setting.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'monospace'],
      },
      // One graphite neutral family + a single ember accent. Danger is semantic (errors only).
      colors: {
        ink: token('ink'),
        surface: token('surface'),
        raised: token('raised'),
        well: token('well'),
        line: 'rgb(var(--line) / var(--line-alpha))',
        fg: token('fg'),
        muted: token('muted'),
        faint: token('faint'),
        accent: { DEFAULT: token('accent'), soft: 'rgb(var(--accent) / 0.14)', fg: token('accent-fg') },
        danger: { DEFAULT: token('danger'), soft: 'rgb(var(--danger) / 0.12)' },
      },
      // Shape rule: remote slab 36px, panels 28px, controls 20px, small thumbs 14px; chips, toggles
      // and round transport/power buttons are full pill.
      borderRadius: {
        thumb: '14px',
        control: '20px',
        panel: '28px',
        slab: '36px',
      },
      // Layer scale: grain overlay sits above content but never takes input; toasts above all.
      zIndex: {
        grain: '30',
        overlay: '40',
        toast: '50',
      },
    },
  },
  plugins: [],
}
