
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useSearchParams(): [URLSearchParams, any];

export default function EmbedDemoPage() {
  const [searchParams] = useSearchParams();

  const [token, setToken] = useState(() => searchParams.get('token') || '');
  const [externalId, setExternalId] = useState(() => searchParams.get('externalId') || '');
  const [mode, setMode] = useState<'create' | 'edit'>(
    () => (searchParams.get('mode') as 'create' | 'edit') || 'create',
  );

  return null;
}
