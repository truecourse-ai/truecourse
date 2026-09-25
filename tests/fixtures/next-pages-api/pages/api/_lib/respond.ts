import type { NextApiResponse } from 'next'

// A helper beside the handlers: no default export, so no route.
export function respond(res: NextApiResponse, body: unknown) {
  if (res.req?.method === 'HEAD') return res.status(200).end()
  res.status(200).json(body)
}
