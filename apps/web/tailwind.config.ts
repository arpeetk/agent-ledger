import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        neutral: {
          50: '#FAFAF9',
          100: '#F5F5F3',
          150: '#EDEDEB',
          200: '#E5E5E2',
          300: '#D4D4D0',
          400: '#A3A3A0',
          500: '#737370',
          600: '#525250',
          700: '#3F3F3D',
          800: '#2A2A28',
          900: '#1A1A19',
        },
        semantic: {
          green: {
            light: '#ECFDF5',
            DEFAULT: '#16A34A',
            muted: '#15803D',
          },
          red: {
            light: '#FEF2F2',
            DEFAULT: '#DC2626',
            muted: '#B91C1C',
          },
          amber: {
            light: '#FFFBEB',
            DEFAULT: '#D97706',
            muted: '#B45309',
          },
          blue: {
            light: '#EFF6FF',
            DEFAULT: '#2563EB',
            muted: '#1D4ED8',
          },
          purple: {
            light: '#F5F3FF',
            DEFAULT: '#7C3AED',
            muted: '#6D28D9',
          },
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.5rem' }],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(26, 26, 25, 0.04)',
        DEFAULT: '0 1px 3px 0 rgba(26, 26, 25, 0.06), 0 1px 2px -1px rgba(26, 26, 25, 0.06)',
        md: '0 4px 6px -1px rgba(26, 26, 25, 0.06), 0 2px 4px -2px rgba(26, 26, 25, 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
