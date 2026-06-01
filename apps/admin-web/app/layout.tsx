import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Speedwear · Devoluciones',
  description: 'Portal de devoluciones y cambios Speedwear.',
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta httpEquiv="Content-Security-Policy" content="upgrade-insecure-requests" />
        <link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAZ0lEQVR42mPgF9eiKWIYFhb8RwUQCWQ2LpFBZgGaxBC0AGsQYQLqWKB0NI6aFqAFAtB0GloAMR2IaJIP4KbTxAJk06lsAQQNfQvQ7KBVaYrmD+LRoLEAbs1ojTZqwagFoxaMWkACAgBPJ0Hbry10JgAAAABJRU5ErkJggg==" />
      </head>
      <body>{children}</body>
    </html>
  );
}
