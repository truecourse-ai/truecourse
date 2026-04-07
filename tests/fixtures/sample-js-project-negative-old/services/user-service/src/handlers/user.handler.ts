import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import { validateEmail } from '@sample/shared-utils';

const userService = new UserService();

export async function getUsers(_req: Request, res: Response) {
  const users = await userService.getAll();
  res.json(users);
}

export async function getUserById(req: Request, res: Response) {
  const user = await userService.getById(req.params.id);
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
  const user = await userService.create({ name, email });
  res.status(201).json(user);
}

export async function deleteUser(req: Request, res: Response) {
  await userService.delete(req.params.id);
  res.status(204).send();
}
