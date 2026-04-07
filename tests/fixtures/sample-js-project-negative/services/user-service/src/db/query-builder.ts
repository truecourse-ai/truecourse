/**
 * Simple query builder for database operations.
 */

interface QueryOptions {
  table: string;
  columns?: string[];
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
}

const pool = {
  connect: () => ({ query: (q: string, params?: any[]) => [], release: () => {} }),
  query: (q: string, params?: any[]) => [],
};

export class QueryBuilder {
  private table = '';
  private conditions: string[] = [];
  private params: unknown[] = [];
  private orderField = '';
  private limitCount = 0;

  // VIOLATION: code-quality/deterministic/missing-return-type
  from(table: string) {
    this.table = table;
    return this;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  where(column: string, value: unknown) {
    this.params.push(value);
    this.conditions.push(`${column} = $${this.params.length}`);
    return this;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  orderBy(field: string) {
    this.orderField = field;
    return this;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  toSQL() {
    // VIOLATION: database/deterministic/select-star
    let sql = `SELECT * FROM ${this.table}`;

    if (this.conditions.length > 0) {
      sql += ' WHERE ' + this.conditions.join(' AND ');
    }

    if (this.orderField) {
      sql += ` ORDER BY ${this.orderField}`;
    }

    if (this.limitCount > 0) {
      sql += ` LIMIT ${this.limitCount}`;
    }

    return { sql, params: this.params };
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  async execute() {
    const { sql, params } = this.toSQL();
    // VIOLATION: database/deterministic/connection-not-released
    const client = await pool.connect();
    return client.query(sql, params as any[]);
  }
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function buildInsertQuery(table: string, data: Record<string, unknown>) {
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = values.map((_, i) => `$${i + 1}`);

  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    params: values,
  };
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: database/deterministic/unsafe-delete-without-where
export async function truncateTable(table: string) {
  return pool.query(`DELETE FROM ${table}`);
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export async function runMigration(sql: string) {
  // VIOLATION: database/deterministic/missing-migration
  return pool.query(sql);
}
