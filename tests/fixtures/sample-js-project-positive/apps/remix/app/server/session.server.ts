
declare function createCookieSessionStorage<T>(opts: { cookie: { name: string; httpOnly: boolean; maxAge: number; path: string; sameSite: string; secrets: string[]; secure: boolean } }): { getSession: (cookieHeader: string | null) => Promise<T>; commitSession: (session: T) => Promise<string>; destroySession: (session: T) => Promise<string> };

const preferenceStorage = createCookieSessionStorage<{ get: (key: string) => string | undefined; set: (key: string, value: string) => void }>({
  cookie: {
    name: '__user_preferences',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax',
    secrets: ['s3cr3t'],
    secure: process.env.NODE_ENV === 'production',
  },
});

export async function getPreferenceSession(request: Request) {
  const session = await preferenceStorage.getSession(request.headers.get('Cookie'));
  return session;
}

export async function commitPreferenceSession(session: ReturnType<typeof preferenceStorage.getSession> extends Promise<infer T> ? T : never) {
  return preferenceStorage.commitSession(session);
}
