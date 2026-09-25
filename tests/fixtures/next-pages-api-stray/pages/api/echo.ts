// A `pages/api` directory in a package that is not a Next.js app.
export default function echo(req: { method?: string }, res: { end(): void }) {
  if (req.method === 'POST') res.end()
}
