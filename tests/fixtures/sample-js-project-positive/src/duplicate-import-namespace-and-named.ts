/**
 * Positive fixture for architecture/deterministic/duplicate-import.
 *
 * A namespace import (`import * as X from 'm'`) cannot be syntactically
 * merged with a sibling named import (`import { a } from 'm'`). The two
 * legal "combined" forms are `default + named` and `default + namespace`;
 * `namespace + named` is not valid ES module syntax. Flagging this pair
 * as "duplicate, merge them" sends the author down a dead end.
 */

import * as React from 'react';
import { useEffect, useState } from 'react';

export function useToggle(): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(false);
  useEffect(() => {
    React.useRef({ on });
  }, [on]);
  return [on, () => setOn(!on)];
}
