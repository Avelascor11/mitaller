import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Speedwear · Devoluciones',
  description: 'Portal de devoluciones y cambios Speedwear.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta httpEquiv="Content-Security-Policy" content="upgrade-insecure-requests" />
      </head>
      <body>{children}</body>
    </html>
  );
}
