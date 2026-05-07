import { EventEmitter } from 'node:events';

export const events = new EventEmitter();

export interface OrderEvent {
  id: string;
  status: string;
  at: string;
}
