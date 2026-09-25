import type { NextApiRequest, NextApiResponse } from 'next'

// A same-file helper that reads the method for its own reason: not a method served.
function send(res: NextApiResponse, body: unknown) {
  if (res.req?.method === 'HEAD') return res.status(200).end()
  res.status(200).json(body)
}

export default function notes(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  send(res, { ok: true })
}
