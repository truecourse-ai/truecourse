import { Request, Response } from 'express';
import { UserService } from '../services/user.service';

export class UserController {
  // VIOLATION: code-quality/deterministic/mutable-private-member
  private userService = new UserService();

  getAll = async (_req: Request, res: Response) => {
    const users = await this.userService.findAll();
    // INVARIANT-DRIFT: rest-contract — GET /users response-body
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
    // INVARIANT-DRIFT: rest-contract — POST /users status-400
    // INVARIANT-DRIFT: rest-contract — POST /users status-409
    const user = await this.userService.create(req.body);
    res.status(201).json(user);
  };

  delete = async (req: Request, res: Response) => {
    // INVARIANT-DRIFT: rest-contract — DELETE /users/:id status-404
    // INVARIANT-DRIFT: rest-contract — DELETE /users/:id error-envelope:404
    await this.userService.delete(req.params.id);
    res.status(204).send();
  };
}
