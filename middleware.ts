import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { createSupabaseMiddlewareClient } from '@/lib/supabase/middleware';

export async function middleware(req: NextRequest) {
  const basicAuth = req.headers.get('authorization');

  // 從環境變數讀取，確保名稱與 Vercel 的 Environment Variables 完全一致
  const user = process.env.BASIC_AUTH_USER;
  const pwd = process.env.BASIC_AUTH_PASSWORD;

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    const [inputUser, inputPwd] = atob(authValue).split(':');

    if (inputUser === user && inputPwd === pwd) {
      try {
        const { supabase, res } = createSupabaseMiddlewareClient(req);
        await supabase.auth.getUser();
        return res;
      } catch {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
  });
}

// 這是鎖住全站的關鍵，請確保 regex 沒有排除 '/' 根目錄
export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
