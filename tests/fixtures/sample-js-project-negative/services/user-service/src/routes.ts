import { Router } from 'express';
// sorting-style is disabled by default — formatter responsibility.
import { getUsers, getUserById, createUser, deleteUser } from './handlers/user.handler';

export const userRoutes = Router();

userRoutes.get('/', getUsers);
userRoutes.get('/:id', getUserById);
userRoutes.post('/', createUser);
userRoutes.delete('/:id', deleteUser);
