// server-suffix-utility-module: .server.ts that exports cookie/session storage — not a process bootstrap
declare function createCookieStorage(opts: { cookie: { name: string; secrets: string[]; httpOnly: boolean; path: string } }): { getSession: (cookie: string) => Promise<{ get: (key: string) => unknown }> };

const preferenceStorage = createCookieStorage({
  cookie: {
    name: 'user-prefs',
    path: '/',
    httpOnly: true,
    secrets: ['changeme-in-production'],
  },
});

export async function getUserPreferences(cookieHeader: string | null) {
  const session = await preferenceStorage.getSession(cookieHeader ?? '');
  return {
    theme: session.get('theme') as string | undefined,
    locale: session.get('locale') as string | undefined,
  };
}
