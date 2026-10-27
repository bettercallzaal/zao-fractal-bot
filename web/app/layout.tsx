import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-bricolage' });
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'ZAO Fractal',
  description: 'Every ZAO Fractal meeting and every Respect award, read live from the record zao.frapps.xyz uses.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
