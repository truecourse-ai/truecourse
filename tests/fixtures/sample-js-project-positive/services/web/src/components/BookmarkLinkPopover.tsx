declare const useState: <T>(initial: T) => [T, (next: T) => void];
declare const useToast: () => { toast: (opts: { title: string; description: string }) => void };
declare const useBookmarkContext: () => {
  workspace: { bookmarks: { id: string; label: string; href: string }[] };
  setWorkspace: (patch: { bookmarks: { id: string; label: string; href: string }[] }) => void;
};
declare const useBookmarkForm: <T>(opts: { defaultValues: T }) => {
  values: T;
  reset: () => void;
  handleSubmit: (fn: (data: T) => void) => (e: unknown) => void;
  setField: (key: keyof T, value: string) => void;
};
declare const generateId: () => string;
declare const cn: (...parts: (string | undefined)[]) => string;
declare const Popover: (props: { open: boolean; onOpenChange: (next: boolean) => void; children: JSX.Element[] }) => JSX.Element;
declare const PopoverTrigger: (props: { asChild?: boolean; children: JSX.Element }) => JSX.Element;
declare const PopoverContent: (props: { className?: string; align?: string; children: JSX.Element }) => JSX.Element;
declare const Button: (props: {
  variant?: string;
  size?: string;
  type?: string;
  className?: string;
  onClick?: (e?: unknown) => void;
  children: JSX.Element | (JSX.Element | string)[];
}) => JSX.Element;
declare const TextField: (props: {
  name: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) => JSX.Element;
declare const PaperclipIcon: (props: { className?: string }) => JSX.Element;
declare const PlusIcon: (props: { className?: string }) => JSX.Element;
declare const CloseIcon: (props: { className?: string }) => JSX.Element;

export type BookmarkLinkPopoverProps = {
  triggerClassName?: string;
  triggerSize?: 'sm' | 'default';
};

export const BookmarkLinkPopover = ({
  triggerClassName,
  triggerSize,
}: BookmarkLinkPopoverProps) => {
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const { workspace, setWorkspace } = useBookmarkContext();

  const bookmarks = workspace.bookmarks ?? [];

  const form = useBookmarkForm<{ label: string; href: string }>({
    defaultValues: {
      label: '',
      href: '',
    },
  });

  const onSubmit = (data: { label: string; href: string }) => {
    setWorkspace({
      bookmarks: [
        ...bookmarks,
        {
          id: generateId(),
          label: data.label,
          href: data.href,
        },
      ],
    });

    form.reset();
    setIsAdding(false);

    toast({
      title: 'Saved',
      description: 'Bookmark added to the workspace.',
    });
  };

  const onRemoveBookmark = (id: string) => {
    setWorkspace({
      bookmarks: bookmarks.filter((entry) => entry.id !== id),
    });

    toast({
      title: 'Removed',
      description: 'Bookmark cleared from the workspace.',
    });
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('gap-2', triggerClassName)} size={triggerSize}>
          <PaperclipIcon className="h-4 w-4" />
          <span>
            Bookmarks
            {bookmarks.length > 0 && <span className="ml-1">({bookmarks.length})</span>}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium">Bookmarks</h4>
            <p className="mt-1 text-muted-foreground text-sm">
              Pin links to reference material for the current workspace.
            </p>
          </div>

          {bookmarks.length > 0 && (
            <div className="space-y-2">
              {bookmarks.map((bookmark) => (
                <div
                  key={bookmark.id}
                  className="flex items-center justify-between rounded-md border border-border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{bookmark.label}</p>
                    <a
                      href={bookmark.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-muted-foreground text-xs underline hover:text-foreground"
                    >
                      {bookmark.href}
                    </a>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveBookmark(bookmark.id)}
                    className="ml-2 h-8 w-8 p-0"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!isAdding && (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setIsAdding(true)}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Add bookmark
            </Button>
          )}

          {isAdding && (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <TextField
                name="label"
                value={form.values.label}
                placeholder="Label"
                onChange={(next) => form.setField('label', next)}
              />
              <TextField
                name="href"
                value={form.values.href}
                placeholder="https://example.com"
                onChange={(next) => form.setField('href', next)}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setIsAdding(false);
                    form.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="flex-1">
                  Save
                </Button>
              </div>
            </form>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
