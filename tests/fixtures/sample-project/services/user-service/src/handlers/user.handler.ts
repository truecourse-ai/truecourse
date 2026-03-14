import { Request, Response } from 'express';
import { UserRepository } from '../repositories/user.repository';
import { validateEmail } from '@sample/shared-utils';

const repo = new UserRepository();

export async function getUsers(_req: Request, res: Response) {
  const users = await repo.findAll();
  res.json(users);
}

export async function getUserById(req: Request, res: Response) {
  const user = await repo.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(user);
}

export async function createUser(req: Request, res: Response) {
  const { name, email } = req.body;
  if (!validateEmail(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }
  const user = await repo.create({ name, email });
  res.status(201).json(user);
}

export async function deleteUser(req: Request, res: Response) {
  await repo.delete(req.params.id);
  res.status(204).send();
}
