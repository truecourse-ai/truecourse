// Paraphrased FP for code-quality/deterministic/elseif-without-else.
//
// Discriminated-union narrowing — every branch tests a different literal
// of the same variable. The missing `else` is unreachable because the
// union is closed; adding one would be dead code, not a defensive guard.

type Mode = 'checked' | 'value';

interface Row {
  checked: boolean;
  value: string;
}

export function applyUpdate(row: Row, mode: Mode, raw: unknown): void {
  if (mode === 'checked') {
    row.checked = Boolean(raw);
  } else if (mode === 'value') {
    row.value = String(raw);
  }
}

export function normalizeCss(brandingCss: string | null): string | null {
  let out: string | null | undefined;
  if (brandingCss === null) {
    out = null;
  } else if (typeof brandingCss === 'string') {
    out = brandingCss.trim() === '' ? null : brandingCss;
  }
  return out ?? null;
}
