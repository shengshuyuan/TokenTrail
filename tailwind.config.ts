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
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', '"Noto Sans SC"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'eva-green': '0 0 20px rgba(57, 255, 20, 0.15)',
        'eva-purple': '0 0 20px rgba(123, 47, 190, 0.15)',
        'eva-glow': '0 0 30px rgba(57, 255, 20, 0.1), 0 0 60px rgba(123, 47, 190, 0.05)',
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
