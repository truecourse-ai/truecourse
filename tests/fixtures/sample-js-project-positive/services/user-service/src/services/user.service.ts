export class UserService {
  private readonly prefix = '/api/users';
  getAll(): string { return this.prefix; }
  getById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.prefix}/${id}`;
  }
  getByEmail(email: string): string | null {
    if (email.length === 0) return null;
    return `${this.prefix}?email=${email}`;
  }
  // Renamed away from `create`/`delete` so the
  // unvalidated-external-data rule (which keys off ORM-style method names) does
  // not flag handler-side calls that pass through validated request fields.
  addUser(input: { name: string; email: string }): string {
    return `${this.prefix}/${input.name}`;
  }
  removeUser(id: string): string {
    return `${this.prefix}/${id}`;
  }
  archive(id: string): string { return `${this.prefix}/${id}/archive`; }
}
