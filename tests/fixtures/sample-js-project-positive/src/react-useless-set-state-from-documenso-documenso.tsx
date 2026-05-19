/**
 * Paraphrased FPs from documenso/documenso for
 * code-quality/deterministic/react-useless-set-state.
 *
 * The visitor used to match `setX(x)` purely by identifier name, without
 * checking whether the setter actually came from a `useState` destructure
 * and whether the argument was the matching binding from that destructure.
 *
 * Two flavors of FP, both real-world:
 *   1. `setNonce(nonce)` where `setNonce` is imported from a third-party
 *      library (`react-colorful`) and `nonce` is a prop. Neither side is
 *      part of a useState pair.
 *   2. `setX(x)` inside an event handler where `x` is a parameter (or
 *      another fresh binding) that shadows the outer `[x, setX] = useState(...)`
 *      pair by name. The setter writes a fresh value, not the existing state.
 */

import { useState } from 'react';
import { setNonce } from 'react-colorful';

interface ColorPickerProps {
  readonly nonce: string;
}

export function ColorPicker(props: ColorPickerProps): JSX.Element {
  // `setNonce` is imported from `react-colorful` — not a useState setter.
  // `props.nonce` happens to be named `nonce`, which used to trip the
  // name-only match.
  const handleMount = (): void => {
    const { nonce } = props;
    setNonce(nonce);
  };

  return <div data-nonce={props.nonce} onClick={handleMount} />;
}

export function ToggleField(): JSX.Element {
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [required, setRequired] = useState<boolean>(false);

  // Both parameters intentionally collide with the useState binding names.
  // Parameters are not the existing state — they're fresh values handed
  // to the handler.
  const onToggle = (readOnly: boolean, required: boolean): void => {
    setReadOnly(readOnly);
    setRequired(required);
  };

  const handleClick = (): void => {
    onToggle(!readOnly, !required);
  };

  return (
    <div onClick={handleClick}>
      {readOnly ? 'ro' : 'rw'}
      {required ? '!' : ''}
    </div>
  );
}

export function PageCount(): JSX.Element {
  const [count, setCount] = useState<number>(0);

  // `count` here is a parameter — a fresh number passed in from outside,
  // not the existing state value.
  const apply = (count: number): void => {
    setCount(count);
  };

  const handleClick = (): void => {
    apply(count + 1);
  };

  return <button onClick={handleClick}>{count}</button>;
}
