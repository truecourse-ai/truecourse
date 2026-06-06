import { z } from 'zod';

// Regression: TaskVisibility must still fire missing-value.null even after the
// entity-collision fix. The variable name `taskVisibility` matches the contract
// name exactly, so the comparator finds it via direct name match — unaffected
// by the substring-length guard.
// IL-DRIFT: Enum:TaskVisibility / enum.TaskVisibility.missing-value.null
export const taskVisibility = z.enum(['public', 'private']);
