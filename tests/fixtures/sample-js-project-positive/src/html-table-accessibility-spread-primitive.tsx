import * as React from 'react';

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  compact?: boolean;
};

export function PrimitiveTable({ compact, ...props }: TableProps): React.ReactElement {
  return (
    <div className={compact ? 'is-compact' : 'is-default'}>
      <table {...props} />
    </div>
  );
}
