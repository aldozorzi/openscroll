import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { AppProviders } from '../components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'OpenScroll',
    template: '%s · OpenScroll',
  },
  description:
    'A focused micro-learning feed with spaced repetition, built on open feeds and open source.',
  applicationName: 'OpenScroll',
  appleWebApp: {
    capable: true,
    title: 'OpenScroll',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4efe6' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0b0a' },
  ],
};

const bootstrapScript = `
(function () {
  try {
    var mode = localStorage.getItem('openscroll-theme') || 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    var locale = localStorage.getItem('openscroll-locale');
    if (locale) {
      document.documentElement.lang = locale;
      document.documentElement.dir = ['ar', 'he', 'fa'].indexOf(locale) >= 0 ? 'rtl' : 'ltr';
    }
  } catch (error) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: bootstrapScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
