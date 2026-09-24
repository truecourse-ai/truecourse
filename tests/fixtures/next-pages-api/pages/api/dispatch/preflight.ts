import type { NextApiRequest, NextApiResponse } from 'next'

// A CORS preflight answered up front, then the real dispatch.
export default function preflight(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method === 'POST') return res.status(201).json({ ok: true })
  return res.status(405).end()
}
