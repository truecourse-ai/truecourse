
declare const animate25: (from: number, to: number, opts: unknown) => unknown;
declare const motion25: { div: React.ComponentType<{ ref?: unknown; style?: unknown; className?: string; onMouseMove?: (e: MouseEvent) => void; onMouseLeave?: () => void; children: React.ReactNode }> };
declare const useMotionTemplate25: (...args: unknown[]) => unknown;
declare const useMotionValue25: (init: number) => { set: (v: number) => void; get: () => number };
declare const useTransform25: <T>(val: unknown, input: number[], output: T[]) => unknown;
declare const useCallback25: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => T;
declare const useEffect25: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useRef25: <T>(init: T | null) => { current: T | null };
declare const useState25: <T>(init: T) => [T, (v: T) => void];
declare const cn25: (...classes: unknown[]) => string;
declare const Card25: React.ComponentType<{ ref?: unknown; className?: string; children: React.ReactNode }>;
declare const CardContent25: React.ComponentType<{ className?: string; children: React.ReactNode }>;

type ReviewCardProps25 = {
  className?: string;
  reviewerName: string;
  reviewText: string;
  rating: number;
};

export const ReviewCard3D25 = ({ className, reviewerName, reviewText, rating }: ReviewCardProps25) => {
  const boundary25 = 400;
  const [trackMouse, setTrackMouse] = useState25(false);
  const timeoutRef = useRef25<number | undefined>(undefined);

  const cardX = useMotionValue25(0);
  const cardY = useMotionValue25(0);
  const rotateX = useTransform25(cardY, [-600, 600], [8, -8]);
  const rotateY = useTransform25(cardX, [-600, 600], [-8, 8]);

  const diagonalMovement = useTransform25<number>(
    [rotateX, rotateY],
    ([newRotateX, newRotateY]: [number, number]) => newRotateX + newRotateY,
  );

  const sheenPosition = useTransform25(diagonalMovement, [-16, 16], [-100, 200]);
  const sheenOpacity = useTransform25(sheenPosition, [-100, 50, 200], [0, 0.1, 0]);
  const sheenGradient = useMotionTemplate25`linear-gradient(30deg, transparent, rgba(200,200,200 / ${sheenOpacity}) ${sheenPosition}%, transparent)`;

  const cardRef = useRef25<HTMLDivElement>(null);

  const getCardCenter = useCallback25(() => {
    if (!cardRef.current) return { x: 0, y: 0 };
    const rect = cardRef.current.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const handleMouseMove = (e: MouseEvent) => {
    if (!trackMouse) return;
    const center = getCardCenter();
    const distX = e.clientX - center.x;
    const distY = e.clientY - center.y;
    if (Math.abs(distX) < boundary25 && Math.abs(distY) < boundary25) {
      (cardX as { set: (v: number) => void }).set(distX);
      (cardY as { set: (v: number) => void }).set(distY);
    }
  };

  const handleMouseLeave = () => {
    (cardX as { set: (v: number) => void }).set(0);
    (cardY as { set: (v: number) => void }).set(0);
  };

  useEffect25(() => {
    timeoutRef.current = window.setTimeout(() => setTrackMouse(true), 1000);
    return () => window.clearTimeout(timeoutRef.current);
  }, []);

  return (
    <div className={cn25('relative w-full max-w-sm', className)}>
      <motion25.div
        ref={cardRef}
        style={{ rotateX, rotateY, backgroundImage: sheenGradient } as object}
        className="rounded-xl border bg-card p-6 shadow-md"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <Card25>
          <CardContent25 className="pt-4">
            <p className="text-sm text-muted-foreground">{reviewText}</p>
            <p className="mt-4 font-semibold">{reviewerName}</p>
            <p className="text-xs text-yellow-500">{'★'.repeat(rating)}</p>
          </CardContent25>
        </Card25>
      </motion25.div>
    </div>
  );
};
