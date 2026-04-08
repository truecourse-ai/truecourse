import { Router } from 'express';
import { archiveUser, createUser, getUserById, getUsers } from './handlers/user.handler';

export const userRoutes = Router()
  .get('/', getUsers)
  .get('/:id', getUserById)
  .post('/', createUser)
  .post('/:id/archive', archiveUser);
