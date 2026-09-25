import type { NextApiRequest, NextApiResponse } from 'next'
import { StatusCodes } from 'http-status-codes'

// The else refuses by a named status: it serves nothing.
export default function refusedStatus(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ items: [] })
  } else {
    return res.status(StatusCodes.METHOD_NOT_ALLOWED).end()
  }
}
