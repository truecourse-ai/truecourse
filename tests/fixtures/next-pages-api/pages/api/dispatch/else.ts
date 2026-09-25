import type { NextApiRequest, NextApiResponse } from 'next'

// The else serves every method the check did not name.
export default function orElse(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return res.status(201).json({ created: true })
  } else {
    return res.status(200).json({ items: [] })
  }
}
