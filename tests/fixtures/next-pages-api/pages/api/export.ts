import type { NextApiRequest, NextApiResponse } from 'next'

export default function exportLinks(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'HEAD'].includes(req.method ?? '')) return res.status(405).end()
  res.status(200).send('id,url\n')
}
