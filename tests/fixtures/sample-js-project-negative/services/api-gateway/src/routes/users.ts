import { Router } from 'express';
import { UserController } from '../controllers/user.controller';

export const userRouter = Router();
const controller = new UserController();

// VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.get('/', controller.getAll);
// VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.get('/:id', controller.getById);
// VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.post('/', controller.create);
// VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.delete('/:id', controller.delete);
