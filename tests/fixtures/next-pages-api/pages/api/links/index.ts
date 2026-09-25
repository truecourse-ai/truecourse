import type { NextApiRequest, NextApiResponse } from 'next'
import { listLinks, createLink } from '../../../lib/links'

export default async function links(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ links: await listLinks() })
  } else if (req.method === 'POST') {
    const created = await createLink(req.body)
    return res.status(201).json({ link: created })
  }
  return res.status(405).end()
}
