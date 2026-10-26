import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Special_Elite } from 'next/font/google';
import './globals.css';

const plexSans = IBM_Plex_Sans({ variable: '--font-plex-sans', subsets: ['latin'], weight: ['400', '600', '700'] });
const plexMono = IBM_Plex_Mono({ variable: '--font-plex-mono', subsets: ['latin'], weight: ['400', '600'] });
const stamp = Special_Elite({ variable: '--font-stamp', subsets: ['latin'], weight: '400' });

const SITE = 'https://heartstrip.vercel.app';
const DESCRIPTION = 'Live heart rate variability from a Bluetooth heart-rate sensor, printed like an ECG strip: cleaned beats, an in-browser stress model, and Newton by Archetype AI.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Heartstrip',
  description: DESCRIPTION,
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon-32.png', sizes: '32x32' }], apple: '/apple-touch-icon.png' },
  openGraph: { type: 'website', siteName: 'Heartstrip', title: 'Heartstrip', description: DESCRIPTION, url: SITE, images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Heartstrip: a stamped RELAXED verdict above a pink ECG-paper strip of heart rate, RR intervals, HRV and stress' }] },
  twitter: { card: 'summary_large_image', creator: '@nathannam', title: 'Heartstrip', description: DESCRIPTION, images: ['/og.png'] },
};

export const viewport: Viewport = { themeColor: '#fbf1ee' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${stamp.variable}`}>
      <body>{children}</body>
    </html>
  );
}
