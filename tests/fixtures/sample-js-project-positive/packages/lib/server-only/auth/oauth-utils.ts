// 10 minutes — matches OAuth state cookie TTL requirement
const oauthStateMaxAge = 60 * 10;

export function getOAuthStateCookieOptions() {
  return {
    maxAge: oauthStateMaxAge,
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
  };
}
