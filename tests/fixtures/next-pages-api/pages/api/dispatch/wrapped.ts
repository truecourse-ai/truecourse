import type { NextApiRequest, NextApiResponse } from 'next'
import { withMethods } from '../../../lib/links'

const create = (_req: NextApiRequest, res: NextApiResponse) => res.status(201).end()
const update = (_req: NextApiRequest, res: NextApiResponse) => res.status(200).end()

// A wrapper handed a handler per method.
export default withMethods({ POST: create, PUT: update })
