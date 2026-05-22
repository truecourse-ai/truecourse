/**
 * Positive fixture for code-quality/deterministic/useless-escape.
 *
 * The HTML `pattern` attribute on `<input>` is a regular expression
 * parsed by the browser, not a JavaScript string literal. Escape
 * sequences like `\d`, `\w`, `\s` are valid regex shorthand and the
 * backslash is required for correct semantics. The rule should not
 * flag escapes inside a JSX `pattern` attribute value.
 */

import * as React from 'react';

interface Props {
  readonly defaultValue?: string;
}

export function DigitsOnlyInput({ defaultValue }: Props): React.ReactElement {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="^\d+$"
      defaultValue={defaultValue}
    />
  );
}
