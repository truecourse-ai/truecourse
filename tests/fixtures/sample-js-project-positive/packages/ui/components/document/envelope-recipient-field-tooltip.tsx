
declare const TooltipProvider: React.FC<{ children: React.ReactNode }>;
declare const Tooltip: React.FC<{ children: React.ReactNode }>;
declare const TooltipTrigger: React.FC<{ children: React.ReactNode; asChild?: boolean }>;
declare const TooltipContent: React.FC<{ children: React.ReactNode; className?: string }>;

function RecipientFieldBadge({
  recipientName,
  fieldType,
  color,
}: {
  recipientName: string;
  fieldType: string;
  color: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: color }}
          />
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          <p>{recipientName}</p>
          <p className="text-muted-foreground">{fieldType}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
