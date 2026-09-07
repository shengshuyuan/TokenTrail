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

export const DEFAULT_THEME: Theme = 'quiet-workbench'

export const THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  {
    id: 'quiet-workbench',
    name: { zh: '静谧工作台', en: 'Quiet Workbench' },
    description: { zh: '清晰克制、专注高效的现代浅色工作台', en: 'Clean and focused modern light workbench' },
    preview: {
      canvas: '#FCFCFD',
      surface: '#FFFFFF',
      primary: '#157F68',
      secondary: '#202427',
      tertiary: '#626B73',
      text: '#202427',
      muted: '#626B73',
      border: '#E5E8EB',
      chart: ['#157F68', '#202427', '#626B73'],
      radius: 8,
      chamfer: 0,
      chamferCorners: 'none',
      decoration: '#157F68',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif',
    },
  },
  {
    id: 'neon-mecha',
    name: { zh: '玄枢深色', en: 'Dark Mecha' },
    description: { zh: '深邃暗夜、极夜流萤的沉浸极客深色', en: 'Deep dark obsidian and vivid emerald terminal' },
    preview: {
      canvas: '#0B0F15',
      surface: '#151C26',
      primary: '#10B981',
      secondary: '#38BDF8',
      tertiary: '#A78BFA',
      text: '#F1F5F9',
      muted: '#94A3B8',
      border: '#222D3D',
      chart: ['#10B981', '#38BDF8', '#A78BFA'],
      radius: 8,
      chamfer: 0,
      chamferCorners: 'none',
      decoration: '#10B981',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif',
    },
  },
  {
    id: 'editorial-paper',
    name: { zh: '松烟素笺', en: 'Editorial Paper' },
    description: { zh: '温润素笺、松烟琥珀的护眼暖纸质感', en: 'Warm paper and amber ink for relaxed reading' },
    preview: {
      canvas: '#F5EFE6',
      surface: '#FAF6EE',
      primary: '#B45309',
      secondary: '#2F6254',
      tertiary: '#A84424',
      text: '#2B2520',
      muted: '#73685E',
      border: '#DBD1C0',
      chart: ['#B45309', '#2F6254', '#A84424'],
      radius: 8,
      chamfer: 0,
      chamferCorners: 'none',
      decoration: '#B45309',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Serif SC", Georgia, serif',
    },
  },
] as const

const THEME_IDS = new Set<string>(THEME_DEFINITIONS.map(theme => theme.id))

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEME_IDS.has(value)
}

export function normalizeTheme(value: unknown): Theme {
  if (value === 'neon-mecha' || value === 'dark' || value === 'ember-scroll') return 'neon-mecha'
  if (value === 'editorial-paper') return 'editorial-paper'
  if (value === 'quiet-workbench' || value === 'light' || value === 'luminous-glass') return 'quiet-workbench'
  return DEFAULT_THEME
}

export function getThemeDefinition(theme: Theme): ThemeDefinition {
  return THEME_DEFINITIONS.find(item => item.id === theme) ?? THEME_DEFINITIONS[0]
}
