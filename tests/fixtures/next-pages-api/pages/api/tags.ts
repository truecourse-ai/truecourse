import type { NextApiRequest, NextApiResponse } from 'next'
import { createRouter } from 'next-connect'

const router = createRouter<NextApiRequest, NextApiResponse>()

router
  .get(async (_req, res) => {
    res.status(200).json({ tags: [] })
  })
  .patch(async (req, res) => {
    res.status(200).json({ tag: req.body })
  })

export default router.handler()
