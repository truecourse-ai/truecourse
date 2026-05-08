/**
 * empty-function / no-empty-function shapes that should NOT
 * fire:
 *
 * - Default callback prop: `function Comp({ onSelect = () => {} })`.
 * - Empty arrow as object value of an event-handler key:
 *   `{ onClick: () => {}, onClose: () => {} }`.
 * - `noop` / `NOOP` constant binding: `const noop = () => {}`.
 * - Default param value: `function f(cb = () => {})`.
 */

interface DialogProps {
  readonly onConfirm?: () => void;
  readonly onCancel?: () => void;
}

export function Dialog({
  onConfirm = () => {},
  onCancel = () => {},
}: DialogProps): JSX.Element {
  return (
    <div>
      <button onClick={onConfirm}>OK</button>
      <button onClick={onCancel}>X</button>
    </div>
  );
}

// Default param value.
export function withCallback(cb: () => void = () => {}): void {
  cb();
}

// `noop` constant binding.
export const noop = () => {};

// Object-literal event-handler default.
export const defaultHandlers = {
  onClick: () => {},
  onClose: () => {},
  onError: () => {},
};
