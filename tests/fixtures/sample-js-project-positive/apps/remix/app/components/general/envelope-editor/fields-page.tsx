
// FP shape: component body with single hook assignment
declare function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void];
declare function useRef<T>(v: T | null): { current: T | null };

export const EnvelopeFieldsPage = () => {
  const [searchParams] = useSearchParams();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { _ } = useLingui();

  return null;
};
