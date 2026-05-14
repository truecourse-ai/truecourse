
// FP shape fc262b8b5a4d: ts-pattern match on loading state — no type mismatch
declare const match3: <T>(val: T) => { with: <P>(pattern: P, fn: () => JSX.Element) => { otherwise: (fn: () => JSX.Element) => JSX.Element } };
declare const Loader2: React.FC<{ className?: string }>;
declare const isLoading: boolean;
declare const document2: object | null;

function MultiSignView() {
  return (
    <div className="min-h-screen bg-background">
      <div className="relative h-full w-full p-8">
        {match3({ isLoading, document: document2 })
          .with({ isLoading: true }, () => (
            <div className="flex min-h-[400px] w-full items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm">Loading document...</p>
              </div>
            </div>
          ))
          .otherwise(() => (
            <div>Document content</div>
          ))}
      </div>
    </div>
  );
}
