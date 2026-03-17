
export function GraphLegend() {
  return (
    <div className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-lg border border-border bg-card p-2.5 shadow-md text-[11px]">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="h-0 w-5 border-t-2 border-muted-foreground" />
          <span className="text-muted-foreground">Import</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0 w-5 border-t-2 border-dashed border-muted-foreground" />
          <span className="text-muted-foreground">HTTP</span>
        </div>
      </div>
    </div>
  );
}
