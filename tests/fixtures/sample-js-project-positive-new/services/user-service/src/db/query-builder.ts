export class QueryBuilder {
  private readonly table: string;
  private readonly conditions: string[] = [];
  constructor(table: string) { this.table = table; }
  where(column: string, value: string): this {
    this.conditions.push(`${column} = ${value}`);
    return this;
  }
  toSQL(): string {
    let sql = `SELECT id, name, email FROM ${this.table}`;
    if (this.conditions.length > 0) {
      sql = `${sql} WHERE ${this.conditions.join(' AND ')}`;
    }
    return sql;
  }
}
export function buildInsertQuery(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (...)`;
}
