import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Mitaller Admin',
  description: 'Panel operativo para pedidos, taller, stock, compras y envios.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
