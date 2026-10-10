import type { Metadata, Viewport } from 'next';
import './globals.css';
import { LangProvider } from '@/i18n/client';
import { getLang } from '@/i18n/server';

export const metadata: Metadata = {
  title: 'Resume Build AI',
  description: 'Build your resume, take skill tests, and get a verified-skill resume.',
  applicationName: 'Resume Build AI',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Resume Build AI', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1d4ed8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLang();
  return (
    <html lang={lang === 'ta' ? 'ta' : 'en'}>
      <body className="min-h-screen antialiased">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
