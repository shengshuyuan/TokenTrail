'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { t, type Lang, type TranslationKey } from '@/lib/i18n'

interface LanguageContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh')

  // Restore from localStorage on mount (own key to avoid race with page prefs)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tokentrail-lang')
      if (saved === 'zh' || saved === 'en') {
        setLangState(saved)
      }
    } catch {}
  }, [])

  // Keep <html lang> in sync with the active language so screen readers,
  // search engines, and translation prompts see the correct language.
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang)
    try {
      localStorage.setItem('tokentrail-lang', newLang)
    } catch {}
  }, [])

  const translate = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => t(key, lang, params),
    [lang]
  )

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: translate }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLang() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLang must be used within LanguageProvider')
  return ctx
}
