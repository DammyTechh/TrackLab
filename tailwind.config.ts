import type { Config } from 'tailwindcss';

/**
 * Tailwind reads the SAME custom properties the design system emits into
 * tokens.css. There is no second palette here, and no hex literal.
 * A hex in any .tsx file is a lint error (see eslint.config.js).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      brand: {
        DEFAULT: 'var(--brand)',
        press: 'var(--brand-press)',
        surface: 'var(--brand-surface)',
      },
      accent: { DEFAULT: 'var(--accent)', ink: 'var(--accent-ink)' },
      surface: {
        page: 'var(--surface-page)',
        raised: 'var(--surface-raised)',
        sunken: 'var(--surface-sunken)',
        plate: 'var(--surface-plate)',
      },
      line: { subtle: 'var(--line-subtle)', strong: 'var(--line-strong)' },
      ink: {
        strong: 'var(--ink-strong)',
        DEFAULT: 'var(--ink-body)',
        muted: 'var(--ink-muted)',
        ondark: 'var(--ink-on-dark)',
      },
      plate: {
        muted: 'var(--plate-muted)',
      },
      // Three signals. Urgency is the hue; the glyph says which kind.
      calm: { ink: 'var(--signal-calm-ink)', tint: 'var(--signal-calm-tint)' },
      attention: { ink: 'var(--signal-attention-ink)', tint: 'var(--signal-attention-tint)' },
      urgent: { ink: 'var(--signal-urgent-ink)', tint: 'var(--signal-urgent-tint)' },
    },
    borderRadius: {
      none: '0',
      xs: 'var(--radius-xs)',
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      full: 'var(--radius-pill)',
    },
    spacing: {
      0: '0', px: '1px',
      1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)',
      4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)',
      8: 'var(--space-8)', 10: 'var(--space-10)', 12: 'var(--space-12)',
      16: 'var(--space-16)',
    },
    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
      icon: 'var(--font-icon)',
    },
    boxShadow: {
      none: 'none',
      raise: 'var(--shadow-raise)',
      sheet: 'var(--shadow-sheet)',
      sticker: 'var(--shadow-sticker)',
    },
    extend: {
      minHeight: { touch: 'var(--space-12)' },
    },
  },
  plugins: [],
} satisfies Config;
