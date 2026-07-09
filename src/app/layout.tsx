import type { Metadata } from 'next'
import { Providers } from './providers'
import { DEFAULT_THEME, THEME_DEFINITIONS } from '@/lib/themes'
import './globals.css'

export const metadata: Metadata = {
  title: 'TokenTrail — AI Usage Tracker',
  description: 'A local-first AI usage dashboard with four original visual themes',
  icons: {
    icon: '/logo-app.png',
    shortcut: '/logo-app.png',
    apple: '/logo-app.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const themeIds = JSON.stringify(THEME_DEFINITIONS.map(theme => theme.id))

  return (
    <html lang="zh-CN" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=IBM+Plex+Serif:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@400;500;600;700&family=Oxanium:wght@400;500;600;700&family=ZCOOL+XiaoWei&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var prefs = JSON.parse(localStorage.getItem('tokentrail-prefs') || '{}');
  var themes = ${themeIds};
  var param = new URLSearchParams(window.location.search).get('theme');
  var candidate = param !== null ? param : prefs.theme;
  if (candidate === 'dark') candidate = 'neon-mecha';
  if (candidate === 'light') candidate = 'editorial-paper';
  document.documentElement.dataset.theme = themes.indexOf(candidate) >= 0 ? candidate : '${DEFAULT_THEME}';
} catch (_) {
  document.documentElement.dataset.theme = '${DEFAULT_THEME}';
}
            `.trim(),
          }}
        />
      </head>
      <body className="min-h-screen bg-eva-bg antialiased">
        <div className="scan-overlay fixed inset-0 pointer-events-none z-50">
          <div className="scan-overlay-pattern absolute inset-0" />
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
