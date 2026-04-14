export class UserService {
  private readonly baseUrl = 'http://localhost:3001';
  findAll(): string { return `${this.baseUrl}/users`; }
  findById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.baseUrl}/users/${id}`;
  }
  create(input: { name: string; email: string }): string {
    return `${this.baseUrl}/users/${input.name}`;
  }
}
