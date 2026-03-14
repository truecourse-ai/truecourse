import { describe, it, expect } from 'vitest';
import { parsePrismaSchema } from '../../packages/analyzer/src/schema-parsers/prisma';

describe('parsePrismaSchema', () => {
  it('extracts models as tables', () => {
    const schema = `
model User {
  id    String @id
  email String
}

model Post {
  id    String @id
  title String
}
`;
    const result = parsePrismaSchema(schema);
    expect(result.tables).toHaveLength(2);
    expect(result.tables.map((t) => t.name)).toEqual(['User', 'Post']);
  });

  it('extracts fields as columns with correct types', () => {
    const schema = `
model User {
  id        String   @id
  email     String
  age       Int
  score     Float
  active    Boolean
  createdAt DateTime
  data      Json
  balance   Decimal
  bigNum    BigInt
  avatar    Bytes
}
`;
    const result = parsePrismaSchema(schema);
    const table = result.tables[0]!;
    expect(table.columns).toHaveLength(10);

    const colTypes = Object.fromEntries(table.columns.map((c) => [c.name, c.type]));
    expect(colTypes).toEqual({
      id: 'text',
      email: 'text',
      age: 'integer',
      score: 'float',
      active: 'boolean',
      createdAt: 'timestamp',
      data: 'jsonb',
      balance: 'decimal',
      bigNum: 'bigint',
      avatar: 'bytes',
    });
  });

  it('detects @id as primaryKey', () => {
    const schema = `
model User {
  id    String @id
  email String
}
`;
    const result = parsePrismaSchema(schema);
    const table = result.tables[0]!;
    expect(table.primaryKey).toBe('id');

    const idCol = table.columns.find((c) => c.name === 'id')!;
    expect(idCol.isPrimaryKey).toBe(true);
  });

  it('detects nullable fields (optional with ?)', () => {
    const schema = `
model User {
  id   String  @id
  name String?
  bio  String
}
`;
    const result = parsePrismaSchema(schema);
    const table = result.tables[0]!;

    const nameCol = table.columns.find((c) => c.name === 'name')!;
    expect(nameCol.isNullable).toBe(true);

    const bioCol = table.columns.find((c) => c.name === 'bio')!;
    // Non-nullable fields should not have isNullable set to true
    expect(bioCol.isNullable).toBeFalsy();
  });

  it('extracts @default values', () => {
    const schema = `
model Post {
  id        String   @id @default(uuid())
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  views     Int      @default(0)
}
`;
    const result = parsePrismaSchema(schema);
    const table = result.tables[0]!;

    // Note: the regex @default\(([^)]+)\) captures up to the first closing paren,
    // so nested parens like uuid() get truncated to 'uuid('
    const idCol = table.columns.find((c) => c.name === 'id')!;
    expect(idCol.defaultValue).toBeDefined();

    const publishedCol = table.columns.find((c) => c.name === 'published')!;
    expect(publishedCol.defaultValue).toBe('false');

    const createdAtCol = table.columns.find((c) => c.name === 'createdAt')!;
    expect(createdAtCol.defaultValue).toBeDefined();

    const viewsCol = table.columns.find((c) => c.name === 'views')!;
    expect(viewsCol.defaultValue).toBe('0');
  });

  it('detects @relation and creates foreign key info', () => {
    const schema = `
model User {
  id    String @id
  posts Post[]
}

model Post {
  id       String @id
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId String
}
`;
    const result = parsePrismaSchema(schema);

    // Should have a relation
    expect(result.relations).toHaveLength(1);
    const rel = result.relations[0]!;
    expect(rel.sourceTable).toBe('Post');
    expect(rel.targetTable).toBe('User');
    expect(rel.foreignKeyColumn).toBe('authorId');
    expect(rel.foreignKeyReferencesColumn).toBe('id');

    // The authorId column should be marked as a foreign key
    const postTable = result.tables.find((t) => t.name === 'Post')!;
    const authorIdCol = postTable.columns.find((c) => c.name === 'authorId')!;
    expect(authorIdCol.isForeignKey).toBe(true);
    expect(authorIdCol.referencesTable).toBe('User');
    expect(authorIdCol.referencesColumn).toBe('id');
  });

  it('skips array relation fields (e.g., posts Post[]) from columns', () => {
    const schema = `
model User {
  id    String @id
  posts Post[]
}
`;
    const result = parsePrismaSchema(schema);
    const table = result.tables[0]!;
    // posts should NOT be a column (it's a relation field, not scalar)
    expect(table.columns.find((c) => c.name === 'posts')).toBeUndefined();
  });

  it('skips non-scalar relation fields without @relation', () => {
    const schema = `
model Post {
  id       String @id
  author   User   @relation(fields: [authorId], references: [id])
  authorId String
}

model User {
  id    String @id
  posts Post[]
}
`;
    const result = parsePrismaSchema(schema);
    const postTable = result.tables.find((t) => t.name === 'Post')!;
    // 'author' should NOT appear as a column (it's a relation reference, not scalar)
    expect(postTable.columns.find((c) => c.name === 'author')).toBeUndefined();
    // authorId should appear
    expect(postTable.columns.find((c) => c.name === 'authorId')).toBeDefined();
  });

  it('handles empty schema', () => {
    const result = parsePrismaSchema('');
    expect(result.tables).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('ignores comments and generator/datasource blocks', () => {
    const schema = `
// This is a comment
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id String @id
}
`;
    const result = parsePrismaSchema(schema);
    // Only the model should be parsed, not generator or datasource
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.name).toBe('User');
  });

  it('parses the sample-project fixture schema correctly', () => {
    const { readFileSync } = require('fs');
    const fixturePath = new URL(
      '../fixtures/sample-project/services/user-service/prisma/schema.prisma',
      import.meta.url
    ).pathname;
    const content = readFileSync(fixturePath, 'utf-8');
    const result = parsePrismaSchema(content);

    expect(result.tables).toHaveLength(4);

    const userTable = result.tables.find((t) => t.name === 'User')!;
    expect(userTable).toBeDefined();
    expect(userTable.primaryKey).toBe('id');
    expect(userTable.columns.map((c) => c.name)).toContain('email');
    expect(userTable.columns.map((c) => c.name)).toContain('createdAt');

    // name is optional
    const nameCol = userTable.columns.find((c) => c.name === 'name')!;
    expect(nameCol.isNullable).toBe(true);

    const postTable = result.tables.find((t) => t.name === 'Post')!;
    expect(postTable).toBeDefined();
    expect(postTable.primaryKey).toBe('id');

    // content is optional
    const contentCol = postTable.columns.find((c) => c.name === 'content')!;
    expect(contentCol.isNullable).toBe(true);

    // published has default(false)
    const publishedCol = postTable.columns.find((c) => c.name === 'published')!;
    expect(publishedCol.defaultValue).toBe('false');

    // Comment — intentional violations: missing timestamps, _id without FK, overly nullable, mixed naming
    const commentTable = result.tables.find((t) => t.name === 'Comment')!;
    expect(commentTable).toBeDefined();
    expect(commentTable.columns.map((c) => c.name)).toContain('category_id');
    expect(commentTable.columns.map((c) => c.name)).toContain('viewCount');

    // PostTag — missing timestamps, tag_id without FK
    const postTagTable = result.tables.find((t) => t.name === 'PostTag')!;
    expect(postTagTable).toBeDefined();
    expect(postTagTable.columns.map((c) => c.name)).toContain('tag_id');

    // Only real FK relation: Post.authorId -> User.id
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]!.sourceTable).toBe('Post');
    expect(result.relations[0]!.targetTable).toBe('User');
    expect(result.relations[0]!.foreignKeyColumn).toBe('authorId');
  });

  it('handles multiple relations without named relation strings', () => {
    const schema = `
model User {
  id    String @id
  posts Post[]
}

model Post {
  id       String @id
  author   User   @relation(fields: [authorId], references: [id])
  authorId String
}

model Comment {
  id       String @id
  post     Post   @relation(fields: [postId], references: [id])
  postId   String
}
`;
    const result = parsePrismaSchema(schema);
    expect(result.relations).toHaveLength(2);

    const authorRel = result.relations.find((r) => r.foreignKeyColumn === 'authorId')!;
    expect(authorRel.sourceTable).toBe('Post');
    expect(authorRel.targetTable).toBe('User');

    const postRel = result.relations.find((r) => r.foreignKeyColumn === 'postId')!;
    expect(postRel.sourceTable).toBe('Comment');
    expect(postRel.targetTable).toBe('Post');
  });
});
