/**
 * Type-system edge cases that produce TS diagnostics whose CODE is NOT an
 * argument type mismatch (2345 / 2554 / 2769) but whose POSITION falls
 * inside a call_expression's line range. The argument-type-mismatch rule
 * must filter by diagnostic code, not by mere presence-in-range, so these
 * call sites should not be flagged.
 *
 * The TS errors below are intentional. They are not suppressed (`@ts-ignore`
 * would hide them from getSemanticDiagnostics and defeat the test).
 */

interface Pet {
  name: string;
  species: 'cat' | 'dog';
}

declare const pet: Pet;

// TS2339: Property 'age' does not exist on type 'Pet'.
// `JSON.stringify` itself is well-typed; the FP came from the rule treating
// any in-range diagnostic as an argument-type mismatch.
export function dumpPetAge(): string {
  return JSON.stringify(pet.age);
}

// TS2339: Property 'foo' does not exist on type 'Pet'.
// The outer `Boolean(...)` call is well-typed (accepts unknown).
export function isPetFooSet(): boolean {
  return Boolean(pet.foo);
}
