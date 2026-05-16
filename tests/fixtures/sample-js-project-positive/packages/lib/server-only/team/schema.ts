
declare function z_string(): { min(n: number, opts?: object): any; max(n: number, opts?: object): any; regex(re: RegExp, msg?: string): any };

const teamUrlSchema = z_string()
  .min(3, { message: 'Team URL must be at least 3 characters.' })
  .max(30, { message: 'Team URL must not exceed 30 characters.' })
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Team URL can only contain letters, numbers, dashes and underscores.');
