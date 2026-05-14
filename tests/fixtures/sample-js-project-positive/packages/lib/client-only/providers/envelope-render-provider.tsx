
declare const createContext38: <T>(defaultValue: T) => React.Context<T>;
declare const useContext38: <T>(ctx: React.Context<T>) => T;
declare const useState38: <T>(init: T) => [T, (v: T) => void];
declare const useEffect38: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useMemo38: <T>(fn: () => T, deps: unknown[]) => T;
declare const useCallback38: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => T;
declare const getDataUrl38: (data: unknown) => Promise<string>;
declare const getRecipientColorKey38: (recipientId: number) => string;

type PageRenderData38 = {
  scale: number;
  pageIndex: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  loadingState: 'loading' | 'loaded' | 'error';
};

type CanvasItem38 = {
  id: string;
  title: string;
  order: number;
  canvasId: string;
  data: Uint8Array | string;
};

type CanvasRenderProviderValue38 = {
  canvasItems: CanvasItem38[];
  currentItem: CanvasItem38 | null;
  setCurrentItem: (itemId: string) => void;
  fields: Array<{ id: number; type: string; pageNumber: number }>;
  recipients: Array<{ id: number; name: string; email: string; status: string }>;
  getRecipientColor: (recipientId: number) => string;
  renderError: boolean;
  setRenderError: (v: boolean) => void;
};

const CanvasRenderContext38 = createContext38<CanvasRenderProviderValue38 | null>(null);

interface CanvasRenderProviderProps38 {
  children: React.ReactNode;
  canvasId: string;
  canvasItems: CanvasItem38[];
  fields: CanvasRenderProviderValue38['fields'];
  recipients: CanvasRenderProviderValue38['recipients'];
  overrideSettings?: { showTooltips?: boolean };
}

export const CanvasRenderProvider38 = ({
  children,
  canvasId,
  canvasItems,
  fields,
  recipients,
  overrideSettings,
}: CanvasRenderProviderProps38) => {
  const [currentItemId, setCurrentItemId] = useState38<string | null>(null);
  const [renderError, setRenderError] = useState38(false);

  const sortedItems = useMemo38(
    () => [...canvasItems].sort((a, b) => a.order - b.order),
    [canvasItems],
  );

  const currentItem = useMemo38(
    () => sortedItems.find((item) => item.id === currentItemId) ?? sortedItems[0] ?? null,
    [sortedItems, currentItemId],
  );

  useEffect38(() => {
    if (sortedItems.length > 0 && !currentItemId) {
      setCurrentItemId(sortedItems[0].id);
    }
  }, [sortedItems, currentItemId]);

  const setCurrentItem = useCallback38((itemId: string) => {
    setCurrentItemId(itemId);
    setRenderError(false);
  }, []) as (itemId: string) => void;

  const getRecipientColor = useCallback38((recipientId: number) => {
    return getRecipientColorKey38(recipientId);
  }, []) as (recipientId: number) => string;

  const value: CanvasRenderProviderValue38 = {
    canvasItems: sortedItems,
    currentItem,
    setCurrentItem,
    fields,
    recipients,
    getRecipientColor,
    renderError,
    setRenderError,
  };

  return (
    <CanvasRenderContext38.Provider value={value}>
      {children}
    </CanvasRenderContext38.Provider>
  );
};

export const useCanvasRenderContext38 = () => {
  const ctx = useContext38(CanvasRenderContext38);
  if (!ctx) throw new Error('useCanvasRenderContext38 must be used within CanvasRenderProvider38');
  return ctx;
};
