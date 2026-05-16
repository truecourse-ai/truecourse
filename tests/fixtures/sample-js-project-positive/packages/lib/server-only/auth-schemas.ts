
// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (Zod .refine with boolean predicate) ---
declare const z: {
  string(): {
    min(n: number, opts: { message: string }): any;
    max(n: number, opts: { message: string }): any;
  };
};
declare function refineString(schema: any): any;

function addRefines(base: any): any {
  return base
    .refine((value: string) => value.length > 25 || /[A-Z]/.test(value), {
      message: 'One uppercase character',
    })
    .refine((value: string) => value.length > 25 || /[a-z]/.test(value), {
      message: 'One lowercase character',
    })
    .refine((value: string) => value.length > 25 || /\d/.test(value), {
      message: 'One number',
    })
    .refine((value: string) => value.length > 25 || /[`~<>?,./!@#$%^&*()\-_"'+=|{}[\];:\\]/.test(value), {
      message: 'One special character is required',
    });
}

export const ZStrongPasswordSchema = addRefines(
  z.string()
    .min(8, { message: 'Must be at least 8 characters in length' })
    .max(72, { message: 'Cannot be more than 72 characters in length' }),
);
