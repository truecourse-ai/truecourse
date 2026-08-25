/*
Idempotency: this seed owns rows identified by stable natural keys. The member is
upserted by its unique email and books are upserted by their unique normalized ISBNs,
so rerunning the seed updates the same rows instead of creating duplicates and keeps
primary keys stable. The ISBN reserved for POST /books scenarios is deleted before the
manifest is written, ensuring a book created by a previous guard run does not make the
next run's create flow fail with a duplicate ISBN. The script discovers the database's
actual physical column names (snake_case, lowercase, or quoted camelCase) before
writing, which makes the seed repeatable across the app's existing migrations and any
leftover state from an earlier guard run.
*/
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pgPkg from 'pg';

const { Pool } = pgPkg;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe SQL identifier: ${name}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function pickColumn(columns, candidates, label, required = true) {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate;
  }
  if (required) {
    throw new Error(`could not find ${label}; available columns: ${Array.from(columns).sort().join(', ')}`);
  }
  return null;
}

function base64url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signMemberJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

async function ensureBaseTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS members (
      id serial PRIMARY KEY,
      email text UNIQUE,
      display_name text,
      created_at timestamp DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS books (
      id serial PRIMARY KEY,
      isbn text UNIQUE,
      title text,
      author text,
      status text DEFAULT 'unread',
      added_by integer REFERENCES members(id),
      added_at timestamp DEFAULT now(),
      finished_at timestamp,
      archived_at timestamp
    )
  `);
}

async function columnsFor(client, tableName) {
  const result = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1`,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  if (columns.size === 0) {
    throw new Error(`table ${tableName} has no visible columns in schema ${await currentSchema(client)}`);
  }
  return columns;
}

async function currentSchema(client) {
  const result = await client.query('SELECT current_schema() AS schema');
  return result.rows[0]?.schema ?? '<unknown>';
}

async function upsertMember(client, memberCols) {
  const idCol = pickColumn(memberCols, ['id'], 'members id column');
  const emailCol = pickColumn(memberCols, ['email'], 'members email column');
  const displayCol = pickColumn(memberCols, ['display_name', 'displayname', 'displayName'], 'members display name column', false);

  const insertCols = [emailCol];
  const values = ['guard.member@bookclub.test'];
  const updates = [];
  if (displayCol) {
    insertCols.push(displayCol);
    values.push('Guard Seed Member');
    updates.push(`${quoteIdent(displayCol)} = EXCLUDED.${quoteIdent(displayCol)}`);
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const updateSql = updates.length > 0 ? updates.join(', ') : `${quoteIdent(emailCol)} = EXCLUDED.${quoteIdent(emailCol)}`;
  const returningDisplay = displayCol ? `, ${quoteIdent(displayCol)} AS "displayName"` : `, 'Guard Seed Member'::text AS "displayName"`;

  const result = await client.query(
    `INSERT INTO ${quoteIdent('members')} (${insertCols.map(quoteIdent).join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (${quoteIdent(emailCol)}) DO UPDATE SET ${updateSql}
     RETURNING ${quoteIdent(idCol)} AS id, ${quoteIdent(emailCol)} AS email${returningDisplay}`,
    values
  );

  const member = result.rows[0];
  if (!member) throw new Error('member upsert did not return a row');
  const memberId = Number(member.id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new Error(`seeded member has invalid id: ${member.id}`);
  }
  return { id: memberId, email: member.email, displayName: member.displayName || 'Guard Seed Member' };
}

function bookColumnMap(bookCols) {
  return {
    id: pickColumn(bookCols, ['id'], 'books id column'),
    isbn: pickColumn(bookCols, ['isbn'], 'books isbn column'),
    title: pickColumn(bookCols, ['title'], 'books title column'),
    author: pickColumn(bookCols, ['author'], 'books author column'),
    status: pickColumn(bookCols, ['status'], 'books status column'),
    addedBy: pickColumn(bookCols, ['added_by', 'addedby', 'addedBy'], 'books added-by column', false),
    finishedAt: pickColumn(bookCols, ['finished_at', 'finishedat', 'finishedAt'], 'books finished-at column', false),
    archivedAt: pickColumn(bookCols, ['archived_at', 'archivedat', 'archivedAt'], 'books archived-at column', false)
  };
}

async function deleteBookByIsbn(client, cols, isbn) {
  await client.query(
    `DELETE FROM ${quoteIdent('books')} WHERE ${quoteIdent(cols.isbn)} = $1`,
    [isbn]
  );
}

async function upsertBook(client, cols, book) {
  const insertCols = [cols.isbn, cols.title, cols.author, cols.status];
  const values = [book.isbn, book.title, book.author, book.status];

  if (cols.addedBy) {
    insertCols.push(cols.addedBy);
    values.push(book.addedBy);
  }
  if (cols.finishedAt) {
    insertCols.push(cols.finishedAt);
    values.push(book.finishedAt ?? null);
  }
  if (cols.archivedAt) {
    insertCols.push(cols.archivedAt);
    values.push(book.archivedAt ?? null);
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const updateCols = insertCols.filter((column) => column !== cols.isbn);
  const updateSql = updateCols.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ');
  const returningFinished = cols.finishedAt ? `, ${quoteIdent(cols.finishedAt)} AS "finishedAt"` : `, NULL::timestamp AS "finishedAt"`;

  const result = await client.query(
    `INSERT INTO ${quoteIdent('books')} (${insertCols.map(quoteIdent).join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (${quoteIdent(cols.isbn)}) DO UPDATE SET ${updateSql}
     RETURNING ${quoteIdent(cols.id)} AS id,
               ${quoteIdent(cols.isbn)} AS isbn,
               ${quoteIdent(cols.title)} AS title,
               ${quoteIdent(cols.author)} AS author,
               ${quoteIdent(cols.status)} AS status${returningFinished}`,
    values
  );

  const row = result.rows[0];
  if (!row) throw new Error(`book upsert for ${book.isbn} did not return a row`);
  return {
    id: Number(row.id),
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    status: row.status,
    finishedAt: row.finishedAt
  };
}

async function missingBookId(client, cols) {
  const result = await client.query(`SELECT COALESCE(MAX(${quoteIdent(cols.id)}), 0) + 100000 AS id FROM ${quoteIdent('books')}`);
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`could not compute a missing book id: ${result.rows[0]?.id}`);
  return id;
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const jwtSecret = requireEnv('BOOKCLUB_JWT_SECRET');
  const outPath = requireEnv('GUARD_SEED_OUT');

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureBaseTables(client);

    const memberCols = await columnsFor(client, 'members');
    const bookCols = await columnsFor(client, 'books');
    const cols = bookColumnMap(bookCols);

    const member = await upsertMember(client, memberCols);

    const createIsbnInput = '0-306-40615-2';
    const createIsbn = '9780306406157';
    await deleteBookByIsbn(client, cols, createIsbn);

    const unreadBook = await upsertBook(client, cols, {
      isbn: '9780743273565',
      title: 'The Great Gatsby',
      author: 'F. Scott Fitzgerald',
      status: 'unread',
      addedBy: member.id,
      finishedAt: null,
      archivedAt: null
    });

    const finishedAt = new Date('2020-01-02T03:04:05.000Z');
    const finishedBook = await upsertBook(client, cols, {
      isbn: '9780061120084',
      title: 'To Kill a Mockingbird',
      author: 'Harper Lee',
      status: 'finished',
      addedBy: member.id,
      finishedAt,
      archivedAt: null
    });

    const finishTargetBook = await upsertBook(client, cols, {
      isbn: '9780143127741',
      title: 'The Wright Brothers',
      author: 'David McCullough',
      status: 'unread',
      addedBy: member.id,
      finishedAt: null,
      archivedAt: null
    });

    const absentId = await missingBookId(client, cols);
    await client.query('COMMIT');

    const now = Math.floor(Date.now() / 1000);
    const token = signMemberJwt({
      sub: String(member.id),
      id: member.id,
      memberId: member.id,
      email: member.email,
      displayName: member.displayName,
      iat: now
    }, jwtSecret);

    const manifest = {
      credentials: {
        member: { value: `Bearer ${token}` }
      },
      fixtures: {
        member: {
          id: member.id,
          email: member.email
        },
        unreadBook: {
          id: unreadBook.id,
          isbn: unreadBook.isbn,
          status: unreadBook.status,
          title: unreadBook.title,
          author: unreadBook.author
        },
        coverBook: {
          id: unreadBook.id,
          isbn: unreadBook.isbn
        },
        finishedBook: {
          id: finishedBook.id,
          isbn: finishedBook.isbn,
          status: finishedBook.status,
          finishedAt: finishedAt.toISOString()
        },
        finishTargetBook: {
          id: finishTargetBook.id,
          isbn: finishTargetBook.isbn,
          status: finishTargetBook.status
        },
        missingBook: {
          id: absentId
        },
        newBookRequest: {
          isbnInput: createIsbnInput,
          isbn: createIsbn,
          title: 'Guard Seed Created Book',
          author: 'Guard Seed Author'
        }
      }
    };

    await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('guard seed rollback failed:', rollbackError && rollbackError.stack ? rollbackError.stack : rollbackError);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('guard seed failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
