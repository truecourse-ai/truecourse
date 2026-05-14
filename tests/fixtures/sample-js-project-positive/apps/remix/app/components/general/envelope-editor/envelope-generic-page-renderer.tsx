declare const cn: (...args: unknown[]) => string;
declare const useInView: (opts?: { threshold?: number }) => [React.RefObject<HTMLDivElement>, boolean];

type GenericPageRendererProps = {
  pageNumber: number;
  imageUrl: string;
  width: number;
  height: number;
  className?: string;
  onVisible?: (pageNumber: number) => void;
  children?: React.ReactNode;
};

export function EnvelopeGenericPageRenderer({
  pageNumber,
  imageUrl,
  width,
  height,
  className,
  onVisible,
  children,
}: GenericPageRendererProps) {
  const [ref, isInView] = useInView({ threshold: 0.1 });

  React.useEffect(() => {
    if (isInView && onVisible) {
      onVisible(pageNumber);
    }
  }, [isInView, pageNumber, onVisible]);

  return (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-sm border bg-white shadow-sm',
        className,
      )}
      style={{ width, height }}
    >
      <img
        src={imageUrl}
        alt={`Page ${pageNumber}`}
        className="pointer-events-none h-full w-full object-contain"
        draggable={false}
      />
      {children && (
        <div className="absolute inset-0">{children}</div>
      )}
      <div className="absolute bottom-1 right-2 select-none">
        <span className="rounded bg-black/30 px-1 text-xs text-white">{pageNumber}</span>
      </div>
    </div>
  );
}
