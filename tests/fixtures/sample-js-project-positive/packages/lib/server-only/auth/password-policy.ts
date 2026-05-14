declare const z: { string: () => { min: (n: number, opts: { message: string }) => { max: (n: number, opts: { message: string }) => { refine: (fn: (v: string) => boolean, opts: { message: string }) => any } } } };

const ZPasswordStrengthSchema = z
  .string()
  .min(8, { message: 'Must be at least 8 characters in length' })
  .max(72, { message: 'Cannot be more than 72 characters in length' })
  .refine((value) => value.length > 25 || /[A-Z]/.test(value), {
    message: 'One uppercase character required',
  });
