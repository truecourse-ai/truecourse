// VIOLATION: architecture/deterministic/cross-service-internal-import
import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import { validateEmail } from '@sample/shared-utils';

const userService = new UserService();

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export async function getUsers(_req: Request, res: Response) {
  const users = await userService.getAll();
  res.json(users);
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export async function getUserById(req: Request, res: Response) {
  const user = await userService.getById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(user);
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export async function createUser(req: Request, res: Response) {
  const { name, email } = req.body;
  if (!validateEmail(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }
  const user = await userService.create({ name, email });
  res.status(201).json(user);
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export async function deleteUser(req: Request, res: Response) {
  await userService.delete(req.params.id);
  res.status(204).send();
}

// VIOLATION: architecture/deterministic/missing-error-status-code
export async function dangerousAction(_req: Request, res: Response) {
  try {
    throw new Error('fail');
  } catch (e) {
    res.json({ error: 'Something went wrong' });
  }
}

// VIOLATION: architecture/deterministic/raw-error-in-response
export async function unsafeErrorHandler(_req: Request, res: Response) {
  try {
    throw new Error('internal failure');
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
