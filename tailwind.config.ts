import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        eva: {
          bg: 'rgb(var(--eva-bg-rgb) / <alpha-value>)',
          panel: 'rgb(var(--eva-panel-rgb) / <alpha-value>)',
          border: 'rgb(var(--eva-border-rgb) / <alpha-value>)',
          'border-light': 'rgb(var(--eva-border-light-rgb) / <alpha-value>)',
          green: 'rgb(var(--eva-green-rgb) / <alpha-value>)',
          'green-dim': 'rgb(var(--eva-green-dim-rgb) / <alpha-value>)',
          purple: 'rgb(var(--eva-purple-rgb) / <alpha-value>)',
          'purple-dark': 'rgb(var(--eva-purple-dark-rgb) / <alpha-value>)',
          orange: 'rgb(var(--eva-orange-rgb) / <alpha-value>)',
          text: 'rgb(var(--eva-text-rgb) / <alpha-value>)',
          'text-dim': 'rgb(var(--eva-text-dim-rgb) / <alpha-value>)',
        },
        status: {
          success: 'rgb(var(--status-success-rgb) / <alpha-value>)',
          warning: 'rgb(var(--status-warning-rgb) / <alpha-value>)',
          danger: 'rgb(var(--status-danger-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        mono: ['var(--theme-font-mono)'],
        sans: ['var(--theme-font-body)'],
      },
      boxShadow: {
        'eva-green': '0 0 20px rgba(var(--theme-primary-rgb), 0.15)',
        'eva-purple': '0 0 20px rgba(var(--theme-secondary-rgb), 0.15)',
        'eva-glow': '0 0 30px rgba(var(--theme-primary-rgb), 0.1), 0 0 60px rgba(var(--theme-secondary-rgb), 0.05)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan-line': 'scanLine 8s linear infinite',
      },
      keyframes: {
        scanLine: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
