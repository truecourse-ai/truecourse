
// delay || 500 is a default debounce fallback; 500ms is the standard UI debounce delay
declare function useDebounce<T>(value: T, delay: number): T;

type MultiSelectProps = {
  delay?: number;
  inputValue: string;
};

function useMultiSelectSearch({ delay, inputValue }: MultiSelectProps) {
  const debouncedSearchTerm = useDebounce(inputValue, delay || 500);
  return debouncedSearchTerm;
}
