import { Router } from 'express';
import { UserController } from '../controllers/user.controller';

export const userRouter = Router();
const controller = new UserController();

// NOTE: architecture/deterministic/route-without-auth-middleware — not detected by visitor in this file
userRouter.get('/', controller.getAll);
// NOTE: architecture/deterministic/route-without-auth-middleware — not detected by visitor in this file
userRouter.get('/:id', controller.getById);
// NOTE: architecture/deterministic/route-without-auth-middleware — not detected by visitor in this file
userRouter.post('/', controller.create);
// NOTE: architecture/deterministic/route-without-auth-middleware — not detected by visitor in this file
userRouter.delete('/:id', controller.delete);
