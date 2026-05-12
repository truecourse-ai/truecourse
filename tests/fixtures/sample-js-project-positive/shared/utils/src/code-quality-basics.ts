export function processData(data: unknown): unknown { return data; }
export function alwaysTrue(): boolean { return true; }
export function showNotification(message: string): string { return `msg:${message}`; }
export function throwError(): never { throw new TypeError('validation error'); }
export function addOne(x: number): number { return x + 1; }
export function getPrototype(obj: Record<string, unknown>): unknown { return Object.getPrototypeOf(obj); }
export function mergeObjects(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> { return { ...a, ...b }; }
export function optionalChain(obj: { value: string } | null): string | undefined { return obj?.value; }
export function nullishCoalesce(x: string | null): string { return x ?? 'default'; }
export function getArrayLength(arr: readonly unknown[]): number { return arr.length; }
export const greeting = 'hello';
export function processItemsInLoop(items: ReadonlyArray<{ readonly id: string; readonly value: number }>): Array<{ process: () => number }> {
  const results: Array<{ process: () => number }> = [];
  for (const item of items) {
    results.push({ process: () => item.value * 2 });
  }
  return results;
}

// Allow invitation validation without auth (accept still requires auth)
// This function handles both cases (success and failure)
// Returns the processed result (or null if not found)
export function commentedCodeClean(): string { return 'no false positives'; }

// Positive: unbounded-array-growth — push in bounded for-of loop
export function boundedPush(items: readonly string[]): string[] { const result: string[] = []; for (const item of items) { result.push(item); } return result; }



// Positive: parameter-reassignment FP — coordinate rotation transform reassigns xPos/yPos
// as part of an intentional algorithm; the new value is immediately used in a
// destructured swap and returned. This is not accidental mutation.
export function adjustPositionForRotation(
  pageWidth: number,
  pageHeight: number,
  xPos: number,
  yPos: number,
  pageRotationInDegrees: number,
): { xPos: number; yPos: number } {
  if (pageRotationInDegrees === 270) {
    xPos = pageWidth - xPos;
    [xPos, yPos] = [yPos, xPos];
  }

  if (pageRotationInDegrees === 90) {
    yPos = pageHeight - yPos;
    [xPos, yPos] = [yPos, xPos];
  }

  // Invert all the positions since it's rotated by 180 degrees.
  if (pageRotationInDegrees === 180) {
    xPos = pageWidth - xPos;
    yPos = pageHeight - yPos;
  }

  return { xPos, yPos };
}

// Positive: parameter-reassignment FP — getAllowedHeaders normalizes the optional
// `allowed` parameter by falling back to a request header when it is undefined,
// and by joining arrays into a comma-separated string otherwise. Intentional
// default-value pattern, not a bug.
declare const RequestHeadersCtor: { new (): { append(k: string, v: string): void; set(k: string, v: string): void } };
interface CorsRequest {
  headers: { get(name: string): string | null };
}
export function getAllowedHeaders(req: CorsRequest, allowed?: string | string[]): InstanceType<typeof RequestHeadersCtor> {
  const headers = new RequestHeadersCtor();

  if (!allowed) {
    allowed = req.headers.get('Access-Control-Request-Headers')!;
    headers.append('Vary', 'Access-Control-Request-Headers');
  } else if (Array.isArray(allowed)) {
    allowed = allowed.join(',');
  }
  if (allowed) {
    headers.set('Access-Control-Allow-Headers', allowed);
  }

  return headers;
}



// Positive: prefer-immediate-return FP — ts-pattern .with() callback returning a typed intermediate variable.
// The explicit TTextFieldMeta / TNumberFieldMeta / TDropdownFieldMeta annotation acts as a compile-time
// type assertion against the broader inferred return type of the match expression; inlining the return
// drops the annotation, so the intermediate variable is semantically meaningful.
type TTextFieldMeta = { readonly type: 'text'; readonly label: string; readonly placeholder: string; readonly required: boolean };
type TNumberFieldMeta = { readonly type: 'number'; readonly label: string; readonly min: number; readonly max: number };
type TDropdownFieldMeta = { readonly type: 'dropdown'; readonly label: string; readonly options: readonly string[]; readonly defaultValue: string };
type TFieldMeta = TTextFieldMeta | TNumberFieldMeta | TDropdownFieldMeta;
type TFieldInput = { readonly kind: 'text'; readonly label: string } | { readonly kind: 'number'; readonly label: string; readonly bounds: { readonly min: number; readonly max: number } } | { readonly kind: 'dropdown'; readonly label: string; readonly options: readonly string[] };
declare const match: <T>(value: T) => { with: <P, R>(pattern: P, handler: (matched: T) => R) => { with: <P2, R2>(pattern: P2, handler: (matched: T) => R2) => { with: <P3, R3>(pattern: P3, handler: (matched: T) => R3) => { exhaustive: () => R | R2 | R3 } } } };
declare const P: { readonly _: unknown };
export function buildFieldMetaFromInput(input: TFieldInput): TFieldMeta {
  return match(input)
    .with({ kind: 'text' }, (text) => {
      const meta: TTextFieldMeta = {
        type: 'text',
        label: text.label,
        placeholder: '',
        required: false,
      };
      return meta;
    })
    .with({ kind: 'number' }, (num) => {
      const meta: TNumberFieldMeta = {
        type: 'number',
        label: num.label,
        min: num.bounds.min,
        max: num.bounds.max,
      };
      return meta;
    })
    .with({ kind: 'dropdown' }, (dd) => {
      const meta: TDropdownFieldMeta = {
        type: 'dropdown',
        label: dd.label,
        options: dd.options,
        defaultValue: dd.options[0] ?? '',
      };
      return meta;
    })
    .exhaustive();
}
