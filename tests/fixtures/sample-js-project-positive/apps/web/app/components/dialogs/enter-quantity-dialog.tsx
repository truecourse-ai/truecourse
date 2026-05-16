
declare const z: any;
declare function t(s: TemplateStringsArray, ...args: any[]): string;

const validateQuantityInput = (minValue?: number, maxValue?: number) => {
  return z.string().superRefine((value: string, ctx: any) => {
    const isValidNumber = /^[0-9.]+$/.test(value.toString());

    if (!isValidNumber) {
      ctx.addIssue({
        code: 'custom',
        message: 'Please enter a valid number',
      });
      return;
    }

    if (typeof minValue === 'number' && parseFloat(value) < minValue) {
      ctx.addIssue({
        code: 'too_small',
        minimum: minValue,
        inclusive: true,
        type: 'number',
      });
      return;
    }

    if (typeof maxValue === 'number' && parseFloat(value) > maxValue) {
      ctx.addIssue({
        code: 'too_big',
        maximum: maxValue,
        inclusive: true,
        type: 'number',
      });
      return;
    }
  });
};
