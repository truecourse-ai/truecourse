import { Router } from 'express';
import { UserController } from '../controllers/user.controller';

export const userRouter = Router();
const controller = new UserController();

// ARCH-VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.get('/', controller.getAll);
// ARCH-VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.get('/:id', controller.getById);
// ARCH-VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.post('/', controller.create);
// ARCH-VIOLATION: architecture/deterministic/route-without-auth-middleware
userRouter.delete('/:id', controller.delete);
