export class UserService {
  private readonly prefix = '/api/users';
  getAll(): string { return this.prefix; }
  getById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.prefix}/${id}`;
  }
  create(input: { name: string; email: string }): string {
    return `${this.prefix}/${input.name}`;
  }
  archive(id: string): string { return `${this.prefix}/${id}/archive`; }
}
