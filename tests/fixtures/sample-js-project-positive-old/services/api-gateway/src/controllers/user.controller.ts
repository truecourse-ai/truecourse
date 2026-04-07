import { Request, Response } from 'express';
import { UserService } from '../services/user.service';

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;

export class UserController {
  private readonly userService = new UserService();

  getAll = async (_req: Request, res: Response): Promise<void> => {
    const users = await this.userService.findAll();
    res.json(users);
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const user = await this.userService.findById(id);
    if (!user) {
      res.status(HTTP_NOT_FOUND).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const rawInput: unknown = req.body;
    const parsed = rawInput as Record<string, unknown>;
    const name = String(parsed.name ?? '');
    const email = String(parsed.email ?? '');
    const user = await this.userService.create({ name, email });
    res.status(HTTP_CREATED).json(user);
  };

  handleRemove = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    await this.userService.handleRemove(id);
    const result = res.status(HTTP_NO_CONTENT);
    result.json({ ok: true });
  };
}
