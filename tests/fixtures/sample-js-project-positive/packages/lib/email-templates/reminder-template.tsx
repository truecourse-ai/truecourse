
// --- shape dd7a2401156a: ts-pattern match().with() for role-based JSX rendering ---
declare function match<T>(val: T): {
  with: <R>(pattern: T, handler: () => R) => { with: <R2>(pattern: T, handler: () => R2) => { exhaustive: () => R | R2 } };
  exhaustive: () => unknown;
};

type RecipientRole = 'SIGNER' | 'VIEWER' | 'APPROVER' | 'CC';
declare const role: RecipientRole;
declare const Trans: (props: { children: string }) => JSX.Element;

const actionLabel = match(role)
  .with('SIGNER', () => <Trans>Sign Document</Trans>)
  .with('VIEWER', () => <Trans>View Document</Trans>)
  .exhaustive();
