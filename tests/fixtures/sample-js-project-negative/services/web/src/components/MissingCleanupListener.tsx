// True bug pattern: useEffect attaches a window event listener but
// never returns a cleanup function. On each re-render or unmount, a
// new listener is added and the old one leaks.

import { useEffect, useState } from 'react';

export function WindowSizeWatcher(): JSX.Element {
  const [width, setWidth] = useState<number>(0);

  // VIOLATION: performance/deterministic/missing-cleanup-useeffect
  useEffect(() => {
    const handleResize = (): void => {
      setWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
  }, []);

  return <span>{width}</span>;
}
