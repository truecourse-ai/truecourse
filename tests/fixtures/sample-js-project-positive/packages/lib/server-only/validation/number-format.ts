
// Number format validation — ASCII digits and punctuation only, unicode flag adds nothing.
export const NUMBER_FORMAT_OPTIONS = [
  {
    label: '1,234.56',
    value: '1,234.56',
    regex: /^(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?$/,
  },
  {
    label: '1.234,56',
    value: '1.234,56',
    regex: /^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?$/,
  },
];



declare const z: { string: () => any };
declare const t: (s: TemplateStringsArray, ...args: unknown[]) => string;

// ASCII-only char class /^[0-9,.]+$/ for numeric field validation — no Unicode code points involved.
export const ZNumericFieldSchema = z.string().superRefine((value: string, ctx: any) => {
  const isValidNumber = /^[0-9,.]+$/.test(value.toString());
  if (!isValidNumber) {
    ctx.addIssue({
      code: 'custom',
      message: 'Please enter a valid number',
    });
  }
});



// Locale number format validation — ASCII digits and punctuation, unicode flag unnecessary.
export const LOCALE_NUMBER_FORMATS = [
  {
    label: '1,234.56',
    value: '1,234.56',
    regex: /^(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?$/,
  },
  {
    label: '1 234,56',
    value: '1 234,56',
    regex: /^(?:\d{1,3}(?:\s\d{3})*|\d+)(?:,\d{1,2})?$/,
  },
  {
    label: '1234.56',
    value: '1234.56',
    regex: /^(?:\d+)(?:\.\d{1,2})?$/,
  },
];
