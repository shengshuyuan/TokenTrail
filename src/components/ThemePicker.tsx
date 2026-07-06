'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Theme } from '@/types'
import { getThemeDefinition, THEME_DEFINITIONS } from '@/lib/themes'
import { useLang } from '@/lib/LanguageContext'

interface ThemePickerProps {
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

export function ThemePicker({ theme, onThemeChange }: ThemePickerProps) {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const current = getThemeDefinition(theme)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => {
      optionRefs.current[THEME_DEFINITIONS.findIndex(item => item.id === theme)]?.focus()
    })

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, theme])

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const lastIndex = THEME_DEFINITIONS.length - 1
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = lastIndex

    if (nextIndex !== null) {
      event.preventDefault()
      optionRefs.current[nextIndex]?.focus()
    }
  }

  const selectTheme = (nextTheme: Theme) => {
    onThemeChange(nextTheme)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="theme-picker-trigger"
        aria-label={lang === 'zh' ? '选择主题' : 'Choose theme'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="theme-swatch" style={{ background: current.preview.primary }} />
          <span className="theme-swatch -ml-1" style={{ background: current.preview.secondary }} />
        </span>
        <span className="max-w-[7rem] truncate">{current.name[lang]}</span>
        <span className={`text-[11px] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div
          className="theme-picker-popover"
          role="dialog"
          aria-label={lang === 'zh' ? '主题预览' : 'Theme previews'}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-eva-text-dim">
              {lang === 'zh' ? '选择视觉主题' : 'Choose a theme'}
            </span>
            <span className="text-[11px] font-mono text-eva-text-dim/60">ESC</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
            {THEME_DEFINITIONS.map((item, index) => {
              const selected = item.id === theme
              return (
                <button
                  key={item.id}
                  ref={element => {
                    optionRefs.current[index] = element
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`theme-preview-card ${selected ? 'theme-preview-card-active' : ''}`}
                  onClick={() => selectTheme(item.id)}
                  onKeyDown={event => handleOptionKeyDown(event, index)}
                >
                  <span
                    className="theme-preview-canvas"
                    style={{
                      background: item.preview.canvas,
                      color: item.preview.text,
                      fontFamily: item.preview.font,
                    }}
                    aria-hidden="true"
                  >
                    <span
                      className="theme-preview-surface"
                      style={{
                        background: item.preview.surface,
                        borderColor: `${item.preview.primary}66`,
                      }}
                    >
                      <span className="flex gap-1">
                        <span className="h-1.5 w-8 rounded-full" style={{ background: item.preview.primary }} />
                        <span className="h-1.5 w-4 rounded-full" style={{ background: item.preview.secondary }} />
                      </span>
                      <span className="mt-1.5 flex items-end justify-between gap-2">
                        <span className="text-[11px] font-semibold leading-none">Aa 字</span>
                        <span className="flex items-end gap-1">
                          {[42, 72, 54, 88].map((height, barIndex) => (
                          <span
                            key={height}
                            className="w-1.5 rounded-[2px]"
                            style={{
                              height: `${height / 5}px`,
                              background: barIndex % 2 ? item.preview.secondary : item.preview.primary,
                              opacity: 0.78,
                            }}
                          />
                          ))}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="mt-2 flex items-start justify-between gap-2 text-left">
                    <span>
                      <span className="block text-xs font-semibold text-eva-text">{item.name[lang]}</span>
                      <span className="mt-1 block text-[11px] leading-5 text-eva-text-dim">{item.description[lang]}</span>
                    </span>
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? 'border-eva-green bg-eva-green text-eva-bg'
                          : 'border-eva-border text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
