declare namespace React {
  type HTMLAttributes<T> = { className?: string; [key: string]: any };
  function forwardRef<T, P>(render: (props: P, ref: any) => any): any;
}

declare function cn(...args: any[]): string;

const DataTable = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { stickyHeader?: boolean }
>(({ className, stickyHeader, ...props }, ref) => (
  <div className={cn('w-full', stickyHeader ? 'overflow-hidden' : 'overflow-auto')}>
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
));

DataTable.displayName = 'DataTable';
