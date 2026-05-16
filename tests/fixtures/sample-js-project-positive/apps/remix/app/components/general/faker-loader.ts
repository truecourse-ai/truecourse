
// FP: useEffect with [] that performs a one-time dynamic import. No deps needed for a one-shot load.
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useState<T>(init: T | null): [T | null, (val: T | null) => void];

type FakerModule = { faker: { person: { fullName: () => string } } };

function useFakerLoader() {
  const [fakerMod, setFakerMod] = useState<FakerModule | null>(null);

  useEffect(() => {
    void import('@faker-js/faker/locale/en').then((mod) => {
      setFakerMod(mod as unknown as FakerModule);
    });
  }, []);

  return fakerMod;
}



// safe-value-pass-no-property-access: catch(e) only console.error(`label: ${e}`) using template literal coercion; no property access
declare function setUserLocale(locale: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleLocaleChange(locale: string): Promise<void> {
  try {
    await setUserLocale(locale);
  } catch (e) {
    console.error(`Failed to set language: ${e}`);
    showToast('Failed to change language. Please try again.', 'error');
  }
}
