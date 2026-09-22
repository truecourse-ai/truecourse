import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function upload(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  // An ORM call named like a method must not become an operation.
  await prisma.upload.delete({ where: { id: 1 } })
  const parts = req.query.path as string[]
  return res.status(200).json({ stored: parts.join('/') })
}
