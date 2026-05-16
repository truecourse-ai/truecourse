import { cn } from '@sample/ui/lib/utils';

declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function useRef<T>(initial: T | null): { current: T | null };

const MIN_INPUT_WIDTH = 120;
const INPUT_WIDTH_PADDING = 16;

export type DocumentTitleInputProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
};

export const DocumentTitleInput = ({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: DocumentTitleInputProps) => {
  const [title, setTitle] = useState(value);
  const [hasError, setHasError] = useState(false);
  const [inputWidth, setInputWidth] = useState(200);
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (measureRef.current) {
      const width = measureRef.current.offsetWidth;
      const nextWidth = Math.max(width + INPUT_WIDTH_PADDING, MIN_INPUT_WIDTH);
      setInputWidth(nextWidth);
    }
  }, [title]);

  const handleChange = (e: { target: { value: string } }) => {
    const next = e.target.value;
    setTitle(next);
    if (next.trim().length === 0) {
      setHasError(true);
      return;
    }
    setHasError(false);
    onChange(next);
  };

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <input
        ref={inputRef}
        style={{ width: inputWidth }}
        value={title}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'border-b bg-transparent outline-none transition-colors',
          hasError && 'border-red-500',
        )}
      />
      <span ref={measureRef} className="invisible absolute whitespace-pre">
        {title || placeholder}
      </span>
    </div>
  );
};
