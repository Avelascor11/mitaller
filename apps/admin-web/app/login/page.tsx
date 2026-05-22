'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Credenciales incorrectas');

      // Store token in localStorage for API calls
      localStorage.setItem('token', data.accessToken);
      // Set cookie so middleware can protect admin routes
      document.cookie = `admin-token=${data.accessToken}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;

      router.push('/admin/devoluciones');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0f0f; }
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0f0f0f;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          padding: 24px;
        }
        .login-card {
          background: #1a1a1a;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 40px 36px;
          width: 100%;
          max-width: 400px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.6);
        }
        .login-logo {
          text-align: center;
          margin-bottom: 32px;
        }
        .login-logo-mark {
          font-size: 28px;
          font-weight: 900;
          color: #fff;
          letter-spacing: -1px;
        }
        .login-logo-sub {
          font-size: 12px;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-top: 6px;
        }
        .login-divider {
          height: 1px;
          background: rgba(255,255,255,0.08);
          margin-bottom: 28px;
        }
        .login-label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }
        .login-input {
          width: 100%;
          padding: 13px 14px;
          background: rgba(255,255,255,0.06);
          border: 1.5px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          color: #fff;
          font-size: 15px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s;
          margin-bottom: 16px;
        }
        .login-input:focus { border-color: rgba(255,255,255,0.35); }
        .login-input::placeholder { color: rgba(255,255,255,0.2); }
        .login-btn {
          width: 100%;
          padding: 14px;
          background: #fff;
          color: #0f0f0f;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          letter-spacing: -0.2px;
          transition: opacity 0.15s;
          margin-top: 4px;
        }
        .login-btn:hover { opacity: 0.88; }
        .login-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .login-error {
          background: rgba(255,59,48,0.12);
          border: 1px solid rgba(255,59,48,0.3);
          border-radius: 8px;
          padding: 10px 14px;
          color: #ff6b6b;
          font-size: 14px;
          margin-bottom: 16px;
          text-align: center;
        }
        .login-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(0,0,0,0.2);
          border-top-color: #0f0f0f;
          border-radius: 50%;
          display: inline-block;
          animation: spin 0.6s linear infinite;
          margin-right: 8px;
          vertical-align: middle;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-logo-mark">Mitaller</div>
            <div className="login-logo-sub">Panel de administración</div>
          </div>
          <div className="login-divider" />

          <form onSubmit={handleSubmit}>
            {error && <div className="login-error">{error}</div>}

            <label className="login-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="login-input"
              placeholder="admin@speedwear.es"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />

            <label className="login-label" htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              className="login-input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <><span className="login-spinner" />Entrando...</> : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
