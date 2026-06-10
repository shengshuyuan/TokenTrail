import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'TokenTrail — AI Usage Tracker',
  description: 'Local AI token usage dashboard with dark and light EVA themes',
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
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var prefs = JSON.parse(localStorage.getItem('tokentrail-prefs') || '{}');
  document.documentElement.dataset.theme = prefs.theme === 'light' ? 'light' : 'dark';
} catch (_) {
  document.documentElement.dataset.theme = 'dark';
}
            `.trim(),
          }}
        />
      </head>
      <body className="min-h-screen bg-eva-bg antialiased">
        {/* Scan line overlay */}
        <div className="fixed inset-0 pointer-events-none z-50 opacity-[0.04]">
          <div
            className="absolute inset-0"
            style={{
              background:
                'repeating-linear-gradient(0deg, transparent, transparent 1px, var(--eva-grid-green-strong) 1px, var(--eva-grid-green-strong) 2px)',
            }}
          />
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
