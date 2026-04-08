const HTTP_NOT_FOUND = 404;
const HTTP_CREATED = 201;
export class UserController {
  private readonly name = 'UserController';
  getAll(): string { return this.name; }
  getById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.name}:${id}`;
  }
  create(name: string, email: string): { name: string; email: string } {
    return { name: `${this.name}:${name}`, email };
  }
}
export function getStatusCodes(): { notFound: number; created: number } {
  return { notFound: HTTP_NOT_FOUND, created: HTTP_CREATED };
}
