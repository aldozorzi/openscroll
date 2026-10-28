import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OpenScroll',
    short_name: 'OpenScroll',
    description: 'A focused micro-learning feed with spaced repetition.',
    start_url: '/feed',
    display: 'standalone',
    background_color: '#0d0b0a',
    theme_color: '#0d0b0a',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
