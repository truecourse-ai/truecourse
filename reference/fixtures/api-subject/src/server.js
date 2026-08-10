/**
 * The bookclub HTTP service.
 *
 * Importing `./db.js` applies the migrations, so the service is ready to serve the
 * moment it starts listening — including against a datastore that has never been
 * used before.
 */

import express from 'express'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { PORT, redactedDatabaseUrl } from './config.js'
import { db } from './db.js'
import { books } from './schema.js'
import { requireMember } from './auth.js'
import { normalizeIsbn } from './isbn.js'
import { lookupCover } from './covers.js'

const app = express()
app.use(express.json())

/** The shape every book is rendered in. */
function render(book) {
  return {
    id: book.id,
    isbn: book.isbn,
    title: book.title,
    author: book.author,
    status: book.status,
    addedAt: book.addedAt instanceof Date ? book.addedAt.toISOString() : book.addedAt,
    finishedAt: book.finishedAt instanceof Date ? book.finishedAt.toISOString() : book.finishedAt,
  }
}

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'bookclub' })
})

app.get('/books', async (req, res) => {
  const rows = await db.select().from(books).where(isNull(books.archivedAt)).orderBy(desc(books.addedAt))
  res.status(200).json({ books: rows.map(render) })
})

app.post('/books', requireMember, async (req, res) => {
  const { isbn, title, author } = req.body ?? {}
  const normalized = normalizeIsbn(isbn)
  if (!normalized) {
    res.status(400).json({ error: 'isbn must be a valid ISBN-10 or ISBN-13' })
    return
  }
  if (typeof title !== 'string' || title.trim() === '') {
    res.status(400).json({ error: 'title is required' })
    return
  }
  if (typeof author !== 'string' || author.trim() === '') {
    res.status(400).json({ error: 'author is required' })
    return
  }
  const existing = await db.select().from(books).where(eq(books.isbn, normalized))
  if (existing.length > 0) {
    res.status(409).json({ error: 'that book is already on the shelf' })
    return
  }
  const [created] = await db
    .insert(books)
    .values({ isbn: normalized, title: title.trim(), author: author.trim(), addedBy: req.memberId })
    .returning()
  res.status(201).json(render(created))
})

app.get('/books/:id', async (req, res) => {
  const book = await findBook(req.params.id)
  if (book === undefined) {
    res.status(404).json({ error: 'book not found' })
    return
  }
  if (book.archivedAt !== null) {
    res.status(410).json({ error: 'book archived' })
    return
  }
  res.status(200).json(render(book))
})

app.post('/books/:id/finish', requireMember, async (req, res) => {
  const book = await findBook(req.params.id)
  if (book === undefined || book.archivedAt !== null) {
    res.status(404).json({ error: 'book not found' })
    return
  }
  const [updated] = await db
    .update(books)
    .set({ status: 'finished', finishedAt: new Date() })
    .where(eq(books.id, book.id))
    .returning()
  res.status(200).json(render(updated))
})

// EXPERIMENTAL, and deliberately outside the published contract in docs/openapi.yaml:
// what this answers depends on a third-party service the club has no account with, so
// it is not something the shelf can promise. It stays here because it is useful.
app.get('/books/:id/cover', async (req, res) => {
  const book = await findBook(req.params.id)
  if (book === undefined || book.archivedAt !== null) {
    res.status(404).json({ error: 'book not found' })
    return
  }
  try {
    const coverUrl = await lookupCover(book.isbn)
    if (coverUrl === null) {
      res.status(404).json({ error: 'no cover for that book' })
      return
    }
    res.status(200).json({ coverUrl })
  } catch {
    res.status(502).json({ error: 'the cover service is unavailable' })
  }
})

app.use((req, res) => {
  res.status(404).json({ error: 'no such route' })
})

async function findBook(rawId) {
  const id = Number(rawId)
  if (!Number.isInteger(id) || id < 1) return undefined
  const [book] = await db.select().from(books).where(and(eq(books.id, id)))
  return book
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`bookclub listening on http://127.0.0.1:${PORT} (database ${redactedDatabaseUrl()})`)
})
