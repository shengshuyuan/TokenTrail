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
    tertiary: string
    text: string
    muted: string
    border: string
    /** Chart palette (line + bar colors), driven per-theme. */
    chart: string[]
    /** Panel corner radius (px). */
    radius: number
    /** Corner cut size (px); 0 = no chamfer (use radius). */
    chamfer: number
    /** Which diagonal corners the chamfer cuts; used only when chamfer > 0. */
    chamferCorners: 'tr-bl' | 'tl-br' | 'none'
    /** Decoration line accent color. */
    decoration: string
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
      tertiary: '#ff7a45',
      text: '#eef4ef',
      muted: '#9ba9bb',
      border: '#29374a',
      chart: ['#6dff4b', '#a66cff', '#ff7a45'],
      radius: 10,
      chamfer: 11,
      chamferCorners: 'tr-bl',
      decoration: '#6dff4b',
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
      tertiary: '#8f7cdc',
      text: '#f6eadf',
      muted: '#b89a88',
      border: '#563e33',
      chart: ['#d79a5b', '#8f7cdc', '#b5534d'],
      radius: 3,
      chamfer: 8,
      chamferCorners: 'tl-br',
      decoration: '#d79a5b',
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
      tertiary: '#70528f',
      text: '#241f1a',
      muted: '#6b5f55',
      border: '#d4c5b3',
      chart: ['#a84424', '#2f6254', '#70528f'],
      radius: 7,
      chamfer: 0,
      chamferCorners: 'none',
      decoration: '#a84424',
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
      tertiary: '#007b65',
      text: '#17202a',
      muted: '#586575',
      border: '#c9d6e2',
      chart: ['#0067c5', '#5757c9', '#007b65'],
      radius: 16,
      chamfer: 0,
      chamferCorners: 'none',
      decoration: '#5757c9',
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
