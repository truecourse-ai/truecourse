import express from 'express'

export const app = express()

app.use(express.json())

app.get('/ping', (_req, res) => {
  res.status(200).json({ ok: true })
})
