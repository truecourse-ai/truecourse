import type { NextApiRequest, NextApiResponse } from 'next'

// The preflight is the only method check: every other method reaches the body.
export default function preflightOnly(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  res.status(200).json({ ok: true })
}
