/**
 * React patterns that should NOT trigger any rules.
 *
 * Client components use useCallback and useMemo correctly.
 * useEffect with proper cleanup.
 * Keys on mapped children.
 * Memoized components.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Item {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

interface ServerListProps {
  readonly items: readonly Item[];
}

interface InputChangeEvent {
  target: { value: string };
}

export function ServerList({ items }: ServerListProps): ReturnType<typeof memo> {
  return (
    <div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.name}</span>
            <span>{item.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SearchInputProps {
  readonly onSearch: (query: string) => void;
  readonly placeholder: string;
}

export const SearchInput = memo(function SearchInput({
  onSearch,
  placeholder,
}: SearchInputProps) {
  const [query, setQuery] = useState('');

  const handleChange = useCallback(
    (e: InputChangeEvent) => {
      const val = e.target.value;
      setQuery(val);
      onSearch(val);
    },
    [onSearch],
  );

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={placeholder}
      />
      {trimmedQuery.length > 0 && <span>Searching: {trimmedQuery}</span>}
    </div>
  );
});

interface UseIntervalOptions {
  readonly callback: () => void;
  readonly delay: number;
}

export function useInterval({ callback, delay }: UseIntervalOptions): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const tick = (): void => {
      savedCallback.current();
    };
    const id = setInterval(tick, delay);
    return () => {
      clearInterval(id);
    };
  }, [delay]);
}
