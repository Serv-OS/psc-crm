/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:        '#0E0D0A',
        'ink-soft': 'rgba(23,21,15,0.70)',
        'ink-line': 'rgba(244,237,223,0.06)',
        paper:      '#F4EDDF',
        'paper-soft':'#EBE3D0',
        ember:      '#E8743C',
        'ember-deep':'#C75A29',
        muted:      '#948A7A',
        dim:        '#6B6359',
        panel:      'rgba(23,21,15,0.60)',
        card:       'rgba(30,28,22,0.55)',
        bdr:        'rgba(244,237,223,0.08)',
      },
      fontFamily: {
        sans:    ['Geist', '-apple-system', 'BlinkMacSystemFont', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Instrument Serif', 'Georgia', 'serif'],
        mono:    ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      backdropBlur: {
        glass: '24px',
        'glass-heavy': '40px',
      },
      boxShadow: {
        glass: '0 0 0 1px rgba(244,237,223,0.05), 0 8px 32px rgba(0,0,0,0.3)',
        'glass-sm': '0 0 0 1px rgba(244,237,223,0.05), 0 2px 8px rgba(0,0,0,0.2)',
        'glass-lg': '0 0 0 1px rgba(244,237,223,0.06), 0 16px 48px rgba(0,0,0,0.4)',
        'glow-ember': '0 0 20px rgba(232,116,60,0.15), 0 0 60px rgba(232,116,60,0.05)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
