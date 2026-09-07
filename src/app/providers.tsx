'use client'

import type { ReactNode } from 'react'
import { LanguageProvider } from '@/lib/LanguageContext'
import { PreferencesProvider } from '@/lib/PreferencesContext'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <PreferencesProvider>{children}</PreferencesProvider>
    </LanguageProvider>
  )
}
