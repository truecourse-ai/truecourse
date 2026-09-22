import type { NextApiRequest, NextApiResponse } from 'next'

// No method check at all: every method reaches this handler.
export default function health(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ ok: true })
}
