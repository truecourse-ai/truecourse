
declare const React: any;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => (() => void) | void, deps: any[]): void;
declare const MutationObserver: any;
declare const PDF_CONTAINER_SELECTOR: string;
declare function isFieldRequired(field: any): boolean;

function FormFieldContainer({ field, children }: { field: any; children: any }) {
  const [isHighlighted, setIsHighlighted] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const container = document.querySelector(PDF_CONTAINER_SELECTOR);

    if (container?.getAttribute('data-validate-fields') === 'true' && isFieldRequired(field)) {
      ref.current.setAttribute('data-validate', 'true');
      setIsHighlighted(true);
    }

    const observer = new MutationObserver(() => {
      if (ref.current) {
        setIsHighlighted(ref.current.getAttribute('data-validate') === 'true');
      }
    });

    observer.observe(ref.current, { attributes: true });
    return () => observer.disconnect();
  }, [field]);

  return null;
}
