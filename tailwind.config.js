import daisyui from "daisyui";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Bordure par défaut alignée sur `base-300` du thème actif : un simple
      // `border` reste donc sensible au thème clair/sombre, comme l'ancienne
      // règle globale `* { border-color: … }`.
      borderColor: {
        DEFAULT: 'oklch(var(--b3))',
      },
      animation: {
        'fade-in': 'fadeIn .32s ease both',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    // Thèmes WashGuard : DaisyUI est la source de vérité visuelle. Il génère
    // ses variables (--p, --b1, --bc…) à partir de ces couleurs ; le
    // basculement clair/sombre se fait via data-theme sur <html>, synchronisé
    // avec la classe `dark` (store.tsx + script inline de index.html).
    themes: [
      {
        washguard: {
          primary: '#0284c7',
          'primary-content': '#ffffff',
          secondary: '#0ea5e9',
          'secondary-content': '#ffffff',
          accent: '#22d3ee',
          'accent-content': '#083344',
          neutral: '#0f172a',
          'neutral-content': '#e9f0fb',
          'base-100': '#ffffff',
          'base-200': '#f1f5f9',
          'base-300': '#e2e8f0',
          'base-content': '#0f172a',
          success: '#15803d',
          'success-content': '#ffffff',
          warning: '#b45309',
          'warning-content': '#ffffff',
          error: '#b91c1c',
          'error-content': '#ffffff',
          info: '#0284c7',
          'info-content': '#ffffff',
          '--rounded-box': '1rem',
          '--rounded-btn': '0.75rem',
          '--rounded-badge': '999px',
          '--rounded-field': '0.75rem',
          '--rounded-selector': '0.75rem',
          '--rounded-modal': '1rem',
          '--padding-card': '1.25rem',
        },
      },
      {
        'washguard-dark': {
          primary: '#38bdf8',
          'primary-content': '#04121e',
          secondary: '#0ea5e9',
          'secondary-content': '#04121e',
          accent: '#22d3ee',
          'accent-content': '#04121e',
          neutral: '#16243a',
          'neutral-content': '#e9f0fb',
          'base-100': '#101b2d',
          'base-200': '#16243a',
          'base-300': '#22314b',
          'base-content': '#e9f0fb',
          success: '#4ade80',
          'success-content': '#04121e',
          warning: '#fbbf24',
          'warning-content': '#04121e',
          error: '#f87171',
          'error-content': '#04121e',
          info: '#38bdf8',
          'info-content': '#04121e',
          '--rounded-box': '1rem',
          '--rounded-btn': '0.75rem',
          '--rounded-badge': '999px',
          '--rounded-field': '0.75rem',
          '--rounded-selector': '0.75rem',
          '--rounded-modal': '1rem',
          '--padding-card': '1.25rem',
        },
      },
    ],
    darkTheme: 'washguard-dark',
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
};
