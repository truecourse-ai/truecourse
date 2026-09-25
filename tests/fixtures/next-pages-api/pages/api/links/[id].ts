import type { NextApiRequest, NextApiResponse } from 'next'
import { deleteLink, readLink, updateLink } from '../../../lib/links'

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const id = Number(req.query.id)
  switch (req.method) {
    case 'GET':
      return res.status(200).json({ link: await readLink(id) })
    case 'PUT':
      return res.status(200).json({ link: await updateLink(id, req.body) })
    case 'DELETE':
      await deleteLink(id)
      return res.status(204).end()
    default:
      return res.status(405).end()
  }
}

export default handler
