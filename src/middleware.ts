import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/wizard', '/dashboard', '/test', '/results', '/resume', '/notifications', '/jobs', '/tpo', '/admin', '/employer'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Stable per-device id for PIN lockouts (not an auth credential).
  if (!request.cookies.get('rb_device')) {
    response.cookies.set('rb_device', crypto.randomUUID(), {
      httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365, path: '/',
    });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const device = response.cookies.get('rb_device');
        response = NextResponse.next({ request });
        if (device) response.cookies.set(device);
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie if needed. Do not remove.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|workers/|sw.js|manifest.webmanifest|api/).*)'],
};
