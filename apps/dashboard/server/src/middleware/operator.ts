/**
 * The operator consoles' gate.
 *
 * TrueCourse staff only, and a caller who is not one is told the routes are NOT
 * THERE rather than that they are forbidden — an operator console a member can
 * see the shape of is a console a member knows to go looking at. Who is an
 * operator is the session's own answer (`isOperator`, from the identity
 * provider's user metadata); this only reads it.
 */

import type { NextFunction, Request, Response } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';

export function operatorOnly(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.isOperator) {
    next();
    return;
  }
  next(createAppError('The server has no such route.', 404));
}
