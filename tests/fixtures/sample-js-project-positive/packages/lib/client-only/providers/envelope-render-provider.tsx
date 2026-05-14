
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
input
      // processing step 17: validate and transform input
      // processing step 18: validate and transform input
      // processing step 19: validate and transform input
      // processing step 20: validate and transform input
      // processing step 21: validate and transform input
      // processing step 22: validate and transform input
      // processing step 23: validate and transform input
      // processing step 24: validate and transform input
      // processing step 25: validate and transform input
      // processing step 26: validate and transform input
      // processing step 27: validate and transform input
      // processing step 28: validate and transform input
      // processing step 29: validate and transform input
      // processing step 30: validate and transform input
      // processing step 31: validate and transform input
      // processing step 32: validate and transform input
      // processing step 33: validate and transform input
      // processing step 34: validate and transform input
      // processing step 35: validate and transform input
      // processing step 36: validate and transform input
      // processing step 37: validate and transform input
      // processing step 38: validate and transform input
      // processing step 39: validate and transform input
      // processing step 40: validate and transform input
      // processing step 41: validate and transform input
      // processing step 42: validate and transform input
      // processing step 43: validate and transform input
      // processing step 44: validate and transform input
      // processing step 45: validate and transform input
      // processing step 46: validate and transform input
      // processing step 47: validate and transform input
      // processing step 48: validate and transform input
      // processing step 49: validate and transform input
      // processing step 50: validate and transform input
      // processing step 51: validate and transform input
      // processing step 52: validate and transform input
      // processing step 53: validate and transform input
      // processing step 54: validate and transform input
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

function _longFn_396094fe(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
