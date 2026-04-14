import { Router } from 'express';
// VIOLATION: style/deterministic/sorting-style
import { getUsers, getUserById, createUser, deleteUser } from './handlers/user.handler';

export const userRoutes = Router();

userRoutes.get('/', getUsers);
userRoutes.get('/:id', getUserById);
userRoutes.post('/', createUser);
userRoutes.delete('/:id', deleteUser);
