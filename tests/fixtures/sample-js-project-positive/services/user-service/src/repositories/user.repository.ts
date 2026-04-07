import { User } from '../models/user.model';

const storage: User[] = [];

export async function findAll(): Promise<User[]> {
  await Promise.resolve();
  return [...storage];
}

export async function findById(id: string): Promise<User | null> {
  await Promise.resolve();
  return storage.find((user) => user.id === id) ?? null;
}

export async function create(data: { name: string; email: string }): Promise<User> {
  await Promise.resolve();
  const user: User = { id: String(storage.length + 1), ...data };
  storage.push(user);
  return user;
}

export async function remove(id: string): Promise<void> {
  await Promise.resolve();
  const idx = storage.findIndex((entry) => entry.id === id);
  if (idx >= 0) {
    storage.splice(idx, 1);
  }
}
