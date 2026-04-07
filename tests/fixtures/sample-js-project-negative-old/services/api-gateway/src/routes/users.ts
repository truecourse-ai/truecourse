import { Router } from 'express';
import { UserController } from '../controllers/user.controller';

export const userRouter = Router();
const controller = new UserController();

userRouter.get('/', controller.getAll);
userRouter.get('/:id', controller.getById);
userRouter.post('/', controller.create);
userRouter.delete('/:id', controller.delete);
