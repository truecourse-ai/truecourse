import { createUser, deleteUser, getUserById, getUsers } from './handlers/user.handler';
import type { Handler } from './_express-types';

export interface RouteDef {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  handler: Handler;
}

export const userRoutes: RouteDef[] = [
  { method: 'GET', path: '/', handler: getUsers },
  { method: 'GET', path: '/:id', handler: getUserById },
  { method: 'POST', path: '/', handler: createUser },
  { method: 'DELETE', path: '/:id', handler: deleteUser },
];
