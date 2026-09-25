import type { NextApiRequest, NextApiResponse } from 'next'
import { MethodNotAllowedError } from '../_lib/errors'

// The default throws the app's own refusal: it serves nothing.
export default function refusedError(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'PATCH':
      return res.status(200).json({ updated: true })
    default:
      throw new MethodNotAllowedError()
  }
}
