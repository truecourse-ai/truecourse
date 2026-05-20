import { formatDate, formatUser } from './formatters';
import { logger } from './logger';
import { validateEmail, validateName } from './validators';

export interface ProfileInput {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export function describeUser(user: ProfileInput): string {
  if (!validateEmail(user.email)) {
    logger.warn(`Invalid email: ${user.email}`);
  }
  if (!validateName(user.name)) {
    logger.warn(`Short or long name: ${user.name}`);
  }
  const formatted = formatUser(user);
  const joinedAt = formatDate(new Date(user.createdAt));
  return `${formatted.displayName} since ${joinedAt}`;
}
