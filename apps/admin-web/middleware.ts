import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CUSTOMER_DOMAIN = 'devoluciones.speedwear.es';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;

  // On the customer-facing domain:
  // - / and /devoluciones → serve /devoluciones
  // - /admin/* → block (404)
  // - anything else → redirect to /devoluciones
  if (host === CUSTOMER_DOMAIN) {
    if (pathname === '/devoluciones') {
      return NextResponse.next();
    }
    if (pathname.startsWith('/admin')) {
      return new NextResponse(null, { status: 404 });
    }
    // Redirect root and everything else to /devoluciones
    const url = request.nextUrl.clone();
    url.pathname = '/devoluciones';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
