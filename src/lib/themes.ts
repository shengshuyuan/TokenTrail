import type { Theme } from '@/types'

export interface ThemeDefinition {
  id: Theme
  name: {
    zh: string
    en: string
  }
  description: {
    zh: string
    en: string
  }
  preview: {
    canvas: string
    surface: string
    primary: string
    secondary: string
    text: string
    font: string
  }
}

export const DEFAULT_THEME: Theme = 'neon-mecha'

export const THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  {
    id: 'neon-mecha',
    name: { zh: '玄枢流萤', en: 'Neon Mecha' },
    description: { zh: '玄夜机巧与冷萤光流', en: 'Phosphor terminal grid' },
    preview: {
      canvas: '#0a0d13',
      surface: '#141923',
      primary: '#6dff4b',
      secondary: '#a66cff',
      text: '#eef4ef',
      font: '"Oxanium", "Noto Sans SC", sans-serif',
    },
  },
  {
    id: 'ember-scroll',
    name: { zh: '丹砂长卷', en: 'Ember Scroll' },
    description: { zh: '赤金、绢纸与沉静层次', en: 'Charcoal, ember and ink' },
    preview: {
      canvas: '#130f0e',
      surface: '#211815',
      primary: '#d79a5b',
      secondary: '#b5534d',
      text: '#f6eadf',
      font: '"ZCOOL XiaoWei", "Noto Sans SC", serif',
    },
  },
  {
    id: 'editorial-paper',
    name: { zh: '松烟素笺', en: 'Editorial Paper' },
    description: { zh: '松烟墨意、暖纸留白', en: 'Warm paper editorial' },
    preview: {
      canvas: '#f4efe6',
      surface: '#fffaf1',
      primary: '#a84424',
      secondary: '#2f6254',
      text: '#241f1a',
      font: '"Cormorant Garamond", "Noto Serif SC", serif',
    },
  },
  {
    id: 'luminous-glass',
    name: { zh: '晴岚琉光', en: 'Luminous Glass' },
    description: { zh: '晴岚清透与柔亮层次', en: 'Cool, clear and layered' },
    preview: {
      canvas: '#eef3f8',
      surface: '#ffffff',
      primary: '#0067c5',
      secondary: '#5757c9',
      text: '#17202a',
      font: '"Manrope", "Noto Sans SC", sans-serif',
    },
  },
] as const

const THEME_IDS = new Set<string>(THEME_DEFINITIONS.map(theme => theme.id))

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEME_IDS.has(value)
}

export function normalizeTheme(value: unknown): Theme {
  if (value === 'dark') return 'neon-mecha'
  if (value === 'light') return 'editorial-paper'
  return isTheme(value) ? value : DEFAULT_THEME
}

export function getThemeDefinition(theme: Theme): ThemeDefinition {
  return THEME_DEFINITIONS.find(item => item.id === theme) ?? THEME_DEFINITIONS[0]
}
