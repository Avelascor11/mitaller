'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body style={{ margin: 0, background: '#0f0f0f', color: '#fff', fontFamily: 'monospace', padding: 32 }}>
        <h2 style={{ color: '#ef4444', marginBottom: 16 }}>Error detectado</h2>
        <pre style={{ background: '#1a1a1a', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13, color: '#fca5a5', whiteSpace: 'pre-wrap' }}>
          {error?.message || 'Sin mensaje'}
          {'\n\n'}
          {error?.stack || ''}
        </pre>
        <button onClick={reset} style={{ marginTop: 16, padding: '8px 16px', background: '#fff', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          Reintentar
        </button>
      </body>
    </html>
  );
}
