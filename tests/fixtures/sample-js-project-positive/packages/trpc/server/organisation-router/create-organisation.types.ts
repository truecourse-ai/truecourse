declare const z: { string: () => { min: (n: number, opts: any) => { max: (n: number, opts: any) => any } } };

const ZWorkspaceNameSchema = z
  .string()
  .min(3, { message: 'Minimum 3 characters' })
  .max(50, { message: 'Maximum 50 characters' });
