import type { NextApiRequest, NextApiResponse } from 'next'

export default function indexDirectory(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ at: '/api/index' })
}
