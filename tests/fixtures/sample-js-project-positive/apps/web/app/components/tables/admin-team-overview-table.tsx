
declare function useMemo<T>(fn: () => T, deps: any[]): T;
declare const ChevronUpIcon: any;
declare const ChevronDownIcon: any;
declare const ChevronsUpDown: any;
declare const _: (msg: any) => string;
declare const msg: any;
declare function handleColumnSort(col: string): void;
declare const sortBy: string;
declare const sortOrder: string;

const teamColumns = useMemo(() => {
  return [
    {
      header: () => (
        { type: 'div', className: 'flex cursor-pointer items-center', onClick: () => handleColumnSort('name'),
          children: [
            _({ id: 'Name' }),
            sortBy === 'name'
              ? sortOrder === 'asc'
                ? { type: ChevronUpIcon, className: 'ml-2 h-4 w-4' }
                : { type: ChevronDownIcon, className: 'ml-2 h-4 w-4' }
              : { type: ChevronsUpDown, className: 'ml-2 h-4 w-4' },
          ],
        }
      ),
      accessorKey: 'name',
    },
  ];
}, [sortBy, sortOrder]);
