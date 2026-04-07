import { Router } from 'express';
import { createUser, getUserById, getUsers } from './handlers/user.handler';

export const userRoutes = Router();

userRoutes.get('/', getUsers);
userRoutes.get('/:id', getUserById);
userRoutes.post('/', createUser);
