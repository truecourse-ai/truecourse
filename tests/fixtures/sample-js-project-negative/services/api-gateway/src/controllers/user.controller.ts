import { Request, Response } from 'express';
import { UserService } from '../services/user.service';

export class UserController {
  // VIOLATION: code-quality/deterministic/mutable-private-member
  private userService = new UserService();

  getAll = async (_req: Request, res: Response) => {
    const users = await this.userService.findAll();
    res.json(users);
  };

  getById = async (req: Request, res: Response) => {
    const user = await this.userService.findById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  };

  create = async (req: Request, res: Response) => {
    const user = await this.userService.create(req.body);
    res.status(201).json(user);
  };

  delete = async (req: Request, res: Response) => {
    await this.userService.delete(req.params.id);
    res.status(204).send();
  };
}
