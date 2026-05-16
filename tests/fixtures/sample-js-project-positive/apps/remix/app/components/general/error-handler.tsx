
// FF43 — ts-pattern match().with() exhaustive matching; string literal argument is correct usage
declare function match<T>(value: T): {
  with<P>(pattern: P, handler: () => unknown): { with<P2>(pattern: P2, handler: () => unknown): { exhaustive(): unknown }; exhaustive(): unknown };
  exhaustive(): unknown;
};
type ValidationError = 'MISSING_FIELDS' | 'INVALID_FORMAT' | 'DUPLICATE_ENTRY';
declare const validationErrorCode: ValidationError;

const errorMessage = match(validationErrorCode)
  .with('MISSING_FIELDS', () => 'Please fill in all required fields.')
  .with('INVALID_FORMAT', () => 'One or more fields have an invalid format.')
  .with('DUPLICATE_ENTRY', () => 'This entry already exists.')
  .exhaustive();
