
type ValidationSign = { label: string; value: string };
type FieldChoice = { label: string; value: string; isDefault?: boolean };

declare const validationSigns: ValidationSign[];
declare class AppError extends Error { constructor(code: string, opts: { message: string }); }

function resolveValidatedChoice(choices: FieldChoice[], validationRule: string, clickedLabel: string): FieldChoice | null {
  const matchedSign = validationSigns.find((sign) => sign.label === validationRule);

  if (!matchedSign) {
    throw new AppError('INVALID_REQUEST', { message: 'Invalid validation rule' });
  }

  const clickedChoice = choices.find((choice) => choice.label === clickedLabel);
  return clickedChoice ?? null;
}
