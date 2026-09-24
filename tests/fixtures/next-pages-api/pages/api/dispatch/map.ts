import type { NextApiRequest, NextApiResponse } from 'next'

const handlers = {
  GET: (_req: NextApiRequest, res: NextApiResponse) => res.status(200).json([]),
  DELETE: (_req: NextApiRequest, res: NextApiResponse) => res.status(204).end(),
}

export default function mapped(req: NextApiRequest, res: NextApiResponse) {
  const run = handlers[req.method as keyof typeof handlers]
  if (!run) return res.status(405).end()
  return run(req, res)
}
