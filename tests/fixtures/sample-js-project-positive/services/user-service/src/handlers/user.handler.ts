import type { Request, Response } from '../_express-types';
import { UserService } from '../services/user.service';

const userService = new UserService();

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

interface CreateUserBody {
  name: string;
  email: string;
}

// Validation per SPEC.md: email must contain `@` and `.` after it; name non-empty.
function isValidCreateBody(body: unknown): body is CreateUserBody {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as { name?: unknown; email?: unknown };
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) return false;
  if (typeof candidate.email !== 'string') return false;
  const at = candidate.email.indexOf('@');
  if (at < 0) return false;
  const dot = candidate.email.indexOf('.', at);
  return dot > at;
}

export async function getUsers(_req: Request, res: Response): Promise<void> {
  const users = await userService.getAll();
  res.status(HTTP_OK).json({ users });
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const user = await userService.getById(req.params.id);
  if (user === null) {
    res.status(HTTP_NOT_FOUND).json({ error: 'User not found' });
    return;
  }
  res.status(HTTP_OK).json(user);
}

export async function createUser(req: Request, res: Response): Promise<void> {
  if (!isValidCreateBody(req.body)) {
    res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid request body' });
    return;
  }
  const validatedName = req.body.name;
  const validatedEmail = req.body.email;
  const existing = await userService.getByEmail(validatedEmail);
  if (existing !== null) {
    res.status(HTTP_CONFLICT).json({ error: 'Email already in use' });
    return;
  }
  const user = await userService.addUser({ name: validatedName, email: validatedEmail });
  res.status(HTTP_CREATED).json(user);
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const idParam = req.params.id;
  const user = await userService.getById(idParam);
  if (user === null) {
    res.status(HTTP_NOT_FOUND).json({ error: 'User not found' });
    return;
  }
  await userService.removeUser(idParam);
  res.status(HTTP_NO_CONTENT).send();
}
