// Single hook dispatches a 'storage' event — one usage
declare const window: {
  dispatchEvent(e: Event): void;
  addEventListener(event: string, handler: (e: StorageEvent) => void): void;
  removeEventListener(event: string, handler: (e: StorageEvent) => void): void;
};
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useState<T>(v: T | (() => T)): [T, (v: T) => void];
declare class StorageEvent extends Event { constructor(type: string, init?: Partial<StorageEventInit>): StorageEvent }
interface StorageEventInit { key?: string; newValue?: string | null; storageArea?: Storage }

function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window['localStorage' as unknown as never] as unknown as Storage;
      const raw = item?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    setStoredValue(value);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(value) }));
  };

  return [storedValue, setValue];
}
