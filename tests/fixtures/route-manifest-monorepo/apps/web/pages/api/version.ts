// Pages-router API route → GET /api/version
export default function handler(_req: unknown, res: { json: (b: unknown) => void }): void {
  res.json({ version: '1.0.0' })
}
