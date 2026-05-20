const TOKEN_END = 10;
const SECRET_END = 16;
const SESSION_END = 12;
const RADIX = 36;

export function seedDemoAccount(): { token: string; secret: string } {
  const token = Math.random().toString(RADIX).slice(2, TOKEN_END);
  const secret = Math.random().toString(RADIX).slice(2, SECRET_END);
  return { token, secret };
}

export function seedDemoSession(): { sessionKey: string } {
  const sessionKey = `sess_${Math.random().toString(RADIX).slice(2, SESSION_END)}`;
  return { sessionKey };
}
