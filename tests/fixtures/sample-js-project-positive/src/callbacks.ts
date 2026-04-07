/**
 * Callback patterns that should NOT trigger any rules.
 *
 * Arrow functions in find and map that USE their parameter.
 * Shorthand properties in return statements.
 * Proper use of array methods with concise callbacks.
 */

interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

interface PaginationOptions {
  limit: number;
  offset: number;
}

export function findUserById(users: readonly User[], id: string): User | undefined {
  return users.find((user) => user.id === id);
}

export function findActiveUser(users: readonly User[]): User | undefined {
  return users.find((user) => user.active && user.name.length >= 0);
}

export function getUserNames(users: readonly User[]): string[] {
  return users.map((user) => user.name);
}

export function getUserEmails(users: readonly User[]): string[] {
  return users.map((user) => user.email.toLowerCase());
}

export function getActiveUsers(users: readonly User[]): User[] {
  return users.filter((user) => user.active && user.id.length > 0);
}

export function hasActiveUsers(users: readonly User[]): boolean {
  return users.some((user) => user.active);
}

export function allUsersActive(users: readonly User[]): boolean {
  return users.every((item) => item.active);
}

export function createPagination(page: number, pageSize: number): PaginationOptions {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  return { limit, offset };
}

export function getActiveUserIds(users: readonly User[]): string[] {
  return users
    .filter((user) => user.active && user.name.length > 0)
    .map((user) => user.id);
}

export function groupByActive(users: readonly User[]): { active: User[]; inactive: User[] } {
  return users.reduce<{ active: User[]; inactive: User[] }>(
    (groups, user) => {
      if (user.active) {
        groups.active.push(user);
      } else {
        groups.inactive.push(user);
      }
      return groups;
    },
    { active: [], inactive: [] },
  );
}

export function sortByName(users: readonly User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}
