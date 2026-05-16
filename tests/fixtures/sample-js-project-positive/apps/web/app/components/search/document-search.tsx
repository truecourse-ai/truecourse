
// useDebouncedValue with 500ms is a standard UI debounce delay, intent is self-evident
declare function useDebouncedValue<T>(value: T, delay: number): T;
declare function useState<T>(init: T): [T, (v: T) => void];

function useDocumentSearch(initialValue = '') {
  const [searchTerm, setSearchTerm] = useState(initialValue);
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 500);
  return { searchTerm, setSearchTerm, debouncedSearchTerm };
}
