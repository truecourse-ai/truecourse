export const properCharClass = /[a-z]/u;
export function safeRegex(): RegExp { return /[a-z]+/u; }
export const simplePattern = /test/u;
export const uniqueCharClass = /[ab]/u;
export const safeRegexPattern = /^a+$/u;



// shape b2fafb68501b: single contiguous Unicode codepoint range with no repeated subranges
declare const inputString: string;
export const stripDiacritics = inputString.normalize('NFD').replace(/[\u0300-\u036f]/g, '');



// shape-fdfb1e035926: character class containing literal brackets (`[`, escaped `\]`) — not an empty group
declare const passwordSchema: {
  refine: (predicate: (value: string) => boolean, opts: { message: string }) => unknown;
};
export const passwordSpecialCharsRule = passwordSchema.refine(
  (value) => value.length > 25 || /[`~<>?,./!@#$%^&*()\-_"'+=|{}[\];:\\]/.test(value),
  { message: 'Password must contain at least one special character or be longer than 25 characters.' },
);



// shape-91d288bb2249: (?:[-_][a-z0-9]+)* repeats a non-empty group containing
// [-_] followed by one-or-more [a-z0-9]; the group body is never empty,
// so empty-repetition does not apply.
export const teamUrlSlugPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u;
