import express from 'express'

const app = express()

function requireAuth(_req: express.Request, _res: express.Response, next: express.NextFunction) {
  next()
}

function requireRole(role: string) {
  return (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (role === 'admin') next()
  }
}

const secret = process.env.API_SECRET
if (!secret) {
  throw new Error('API_SECRET is required')
}

app.get('/health', (_req, res) => res.status(200).json({ ok: true }))

app.post('/users', requireAuth, (req, res) => {
  if (!req.body.email) return res.status(400).json({ error: 'email required' })
  return res.status(201).json({ id: 'user_1' })
})

app.get('/admin/reports', requireAuth, requireRole('admin'), (_req, res) => {
  return res.status(200).json({ reports: [] })
})

app.get('/legacy', (_req, res) => res.status(200).json({ legacy: true }))

export { app }
