
declare const z: { string: () => any };

// Password validation — /[A-Z]/ is ASCII uppercase only; unicode flag adds no value.
export const ZStrictPasswordSchema = z
  .string()
  .refine((value) => value.length > 25 || /[A-Z]/.test(value), {
    message: 'Must contain at least one uppercase character',
  })
  .refine((value) => value.length > 25 || /[a-z]/.test(value), {
    message: 'Must contain at least one lowercase character',
  })
  .refine((value) => value.length > 25 || /\d/.test(value), {
    message: 'Must contain at least one digit',
  });



declare const z: { string: () => any };

// /\d/ is ASCII digit shorthand for password validation — unicode flag unnecessary for ASCII-only patterns.
export const ZBasicPasswordSchema = z
  .string()
  .min(8)
  .refine((v) => /\d/.test(v), { message: 'Must contain at least one digit' });
