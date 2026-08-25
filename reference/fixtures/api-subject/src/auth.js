/**
 * Member authentication: a stateless HS256 bearer token, signed with
 * `BOOKCLUB_JWT_SECRET` and verified by every instance of the service.
 *
 * There is no login endpoint. Tokens are issued out of band — by the seed script,
 * or by an operator calling {@link signMemberToken} — which is why a token keeps
 * working across a restart: nothing about it lives in the process.
 */

import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './config.js'

/** A 30-day bearer token for `member` (a row of the `members` table). */
export function signMemberToken(member) {
  return jwt.sign({ sub: String(member.id), email: member.email }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '30d',
  })
}

/** The token's payload, or null when the header is absent, malformed, or invalid. */
export function verifyBearer(authorization) {
  if (typeof authorization !== 'string') return null
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  if (!match) return null
  try {
    return jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] })
  } catch {
    return null
  }
}

/** Express middleware: 401 unless the request carries a valid member token. */
export function requireMember(req, res, next) {
  const payload = verifyBearer(req.headers.authorization)
  if (!payload) {
    res.status(401).json({ error: 'authentication required' })
    return
  }
  req.memberId = Number(payload.sub)
  next()
}
