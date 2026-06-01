import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CUSTOMER_DOMAIN = 'devoluciones.speedwear.es';

// Routes that don't require auth
const PUBLIC_PATHS = ['/login', '/devoluciones'];

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;

  // Force HTTPS — Railway passes x-forwarded-proto or x-forwarded-ssl
  const proto = request.headers.get('x-forwarded-proto')
    ?? request.headers.get('x-forwarded-ssl');
  const isHttps = proto === 'https' || proto === 'on' || request.nextUrl.protocol === 'https:';
  if (!isHttps && proto !== null) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    return NextResponse.redirect(url, 301);
  }

  // ── Customer-facing domain ──
  if (host === CUSTOMER_DOMAIN) {
    // Allow /devoluciones (public portal)
    if (pathname === '/devoluciones') return NextResponse.next();
    // Allow /admin/* and /login (auth protection handled below)
    if (pathname.startsWith('/admin') || pathname.startsWith('/login')) {
      // fall through to auth check below
    } else {
      // Redirect everything else to /devoluciones
      const url = request.nextUrl.clone();
      url.pathname = '/devoluciones';
      return NextResponse.redirect(url);
    }
  }

  // ── Admin domain: protect all routes except public paths ──
  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
  if (!isPublic) {
    const token = request.cookies.get('admin-token')?.value;
    if (!token) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      return NextResponse.redirect(loginUrl);
    }
  }

  // If already logged in and visiting /login, redirect to admin
  if (pathname === '/login') {
    const token = request.cookies.get('admin-token')?.value;
    if (token) {
      const adminUrl = request.nextUrl.clone();
      adminUrl.pathname = '/admin/devoluciones';
      return NextResponse.redirect(adminUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
