import { Request, Response } from 'express';
import { createUser, getAll, getById } from '../services/user.service';
import { validateEmail } from '@sample/shared-utils';

const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

export async function getUsers(_req: Request, res: Response): Promise<void> {
  const users = await getAll();
  res.json(users);
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const user = await getById(id);
  if (!user) {
    res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
    return;
  }
  res.json(user);
}

export async function handleCreateUser(req: Request, res: Response): Promise<void> {
  const rawInput: unknown = req.body;
  if (typeof rawInput !== 'object' || rawInput === null) {
    res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid body' });
    return;
  }
  const parsed = rawInput as Record<string, unknown>;
  const name = String(parsed.name ?? '');
  const email = String(parsed.email ?? '');
  if (!validateEmail(email)) {
    res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid email' });
    return;
  }
  const user = await createUser({ name, email });
  res.status(HTTP_CREATED).json(user);
}

export { handleCreateUser as createUser };
