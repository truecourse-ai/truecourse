export function selectById(table: string, id: string): string {
  return 'SELECT id, name, email FROM ' + table + ' WHERE id = $1 -- ' + id;
}
export function insertRecord(table: string, name: string, email: string): string {
  return 'INSERT INTO ' + table + ' (name, email) VALUES ($1, $2) -- ' + name + email;
}
export function deleteOld(table: string, olderThan: string): string {
  return 'DELETE FROM ' + table + ' WHERE created_at < $1 -- ' + olderThan;
}
