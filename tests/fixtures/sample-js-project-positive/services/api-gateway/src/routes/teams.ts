declare const z: { string: () => { trim: () => { min: (n: number, opts: { message: string }) => { max: (n: number, opts: { message: string }) => any } } } };

const ZTeamSlugSchema = z
  .string()
  .trim()
  .min(3, { message: 'Team slug must be at least 3 characters long.' })
  .max(30, { message: 'Team slug must not exceed 30 characters.' });
