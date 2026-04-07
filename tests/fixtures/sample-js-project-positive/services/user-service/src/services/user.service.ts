import { create, findAll, findById, remove } from '../repositories/user.repository';
import { User } from '../models/user.model';

export async function getAll(): Promise<User[]> {
  const users = await findAll();
  if (users.length === 0) return users;
  return users;
}

export async function getById(id: string): Promise<User | null> {
  const user = await findById(id);
  if (!user) return null;
  return user;
}

export async function createUser(validatedData: { name: string; email: string }): Promise<User> {
  const user = await create(validatedData);
  if (!user.id) throw new Error('Failed to create user');
  return user;
}

export async function removeUser(id: string): Promise<void> {
  await remove(id);
}
