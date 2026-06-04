// The canonical immutable-record update is `const next = { ...prev };
// delete next.key`. The receiver is a plain object map — there is
// no array hole to leave behind — and `delete` is the correct way to
// remove a property. The same holds for the `Object.create(null)` /
// empty-object-literal shapes.

interface FlagOverrides {
  readonly enabled?: boolean;
  readonly debug?: boolean;
  readonly beta?: boolean;
}

export function unsetDebug(prev: FlagOverrides): FlagOverrides {
  const next: { [key: string]: boolean | undefined } = { ...prev };
  delete next["debug"];
  return next as FlagOverrides;
}

export function clearByLiteralKey(): { [k: string]: number } {
  const fresh: { [k: string]: number } = {};
  fresh["alpha"] = 1;
  delete fresh["alpha"];
  return fresh;
}
