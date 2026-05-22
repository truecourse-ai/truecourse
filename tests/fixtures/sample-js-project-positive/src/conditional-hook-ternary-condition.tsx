/**
 * Positive fixture for bugs/deterministic/conditional-hook.
 *
 * The hook call sits in the *condition* of a ternary expression, not in one
 * of its branches. The condition is always evaluated exactly once per render,
 * so the hook is called unconditionally — this does not violate Rules of
 * Hooks. Only hook calls inside the consequence/alternative of an if/ternary
 * (or inside any loop body) are conditional.
 */

import * as React from 'react';

function useHasMounted(): boolean {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

type DeferUntilMountedProps = {
  render: () => React.ReactNode;
  placeholder?: React.ReactNode;
};

export const DeferUntilMounted = ({
  render,
  placeholder = null,
}: DeferUntilMountedProps) => {
  return useHasMounted() ? render() : placeholder;
};
