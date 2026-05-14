
declare const useCallback: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => T;
declare const useRef: <T>(init: T | null) => { current: T | null };

export type ViewportRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export const usePageElement = () => {
  /**
   * Given a pointer event, locate the nearest element matching the given selector.
   */
  const findPage = (event: MouseEvent, pageSelector: string): HTMLElement | null => {
    if (!(event.target instanceof HTMLElement)) {
      return null;
    }

    const target = event.target;

    const $page =
      target.closest<HTMLElement>(pageSelector) ??
      document.elementsFromPoint(event.clientX, event.clientY).find((el) => el.matches(pageSelector)) ?? null;

    return $page as HTMLElement | null;
  };

  /**
   * Given a page element and a child widget element, calculate the widget's
   * bounding box as a percentage of the page dimensions.
   */
  const getWidgetPosition = (page: HTMLElement, widget: HTMLElement): ViewportRect => {
    const pageBounds = page.getBoundingClientRect();
    const widgetBounds = widget.getBoundingClientRect();

    return {
      top: ((widgetBounds.top - pageBounds.top) / pageBounds.height) * 100,
      left: ((widgetBounds.left - pageBounds.left) / pageBounds.width) * 100,
      width: (widgetBounds.width / pageBounds.width) * 100,
      height: (widgetBounds.height / pageBounds.height) * 100,
    };
  };

  /**
   * Determines whether a pointer event falls within the bounds of the nearest
   * element matching the selector, accounting for an optional pointer ghost size.
   */
  const isInsidePageBounds = useCallback(
    (event: MouseEvent, pageSelector: string, ghostWidth = 0, ghostHeight = 0): boolean => {
      const $page = findPage(event, pageSelector);

      if (!$page) {
        return false;
      }

      const { top, left, height, width } = $page.getBoundingClientRect();

      const halfGhostW = ghostWidth / 2;
      const halfGhostH = ghostHeight / 2;

      if (event.clientY > top + height - halfGhostH || event.clientY < top + halfGhostH) {
        return false;
      }

      if (event.clientX > left + width - halfGhostW || event.clientX < left + halfGhostW) {
        return false;
      }

      return true;
    },
    [],
  );

  return {
    findPage,
    getWidgetPosition,
    isInsidePageBounds,
  };
};



declare const useSession28: () => { organisations: Array<{ id: string; name: string }> };
declare const useParams28: () => { teamUrl?: string };
declare const useState28: <T>(init: T) => [T, (v: T) => void];
declare const useEffect28: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const trpc28: { notification: { getUnreadCount: { useQuery: (input: unknown, opts?: unknown) => { data: { count: number } | undefined } } } };
declare const ReadStatus28: { NOT_OPENED: string };
declare const Link28: React.ComponentType<{ to: string; className?: string; children: React.ReactNode }>;
declare const BrandingLogo28: React.ComponentType<{ className?: string }>;
declare const AppNavDesktop28: React.ComponentType;
declare const AppNavMobile28: React.ComponentType<{ isOpen: boolean; onClose: () => void }>;
declare const WorkspaceSwitcher28: React.ComponentType;
declare const CommandMenu28: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void }>;
declare const cn28: (...classes: unknown[]) => string;
declare const HTMLAttributes28: unknown;
declare const InboxIcon28: React.ComponentType<{ className?: string }>;
declare const MenuIcon28: React.ComponentType<{ className?: string }>;
declare const SearchIcon28: React.ComponentType<{ className?: string }>;
declare const Button28: React.ComponentType<{ variant?: string; size?: string; onClick?: () => void; children: React.ReactNode }>;

type DashboardHeaderProps28 = { className?: string } & Record<string, unknown>;

export const DashboardHeader28 = ({ className, ...props }: DashboardHeaderProps28) => {
  const params = useParams28();
  const { organisations } = useSession28();
  const [isCommandOpen, setIsCommandOpen] = useState28(false);
  const [isNavOpen, setIsNavOpen] = useState28(false);
  const [scrollY, setScrollY] = useState28(0);

  const { data: unreadData } = trpc28.notification.getUnreadCount.useQuery(
    { readStatus: ReadStatus28.NOT_OPENED },
    {},
  );

  useEffect28(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn28(
        'sticky top-0 z-[60] flex h-16 w-full items-center border-b border-b-transparent bg-background/95 backdrop-blur duration-200',
        scrollY > 5 && 'border-b-border',
        className,
      )}
      {...props}
    >
      <div className="mx-auto flex w-full max-w-screen-xl items-center justify-between gap-x-4 px-4 md:px-8">
        <Link28 to="/" className="flex items-center gap-2">
          <BrandingLogo28 className="h-6 w-auto" />
        </Link28>

        <WorkspaceSwitcher28 />

        <div className="flex items-center gap-2 ml-auto">
          <Button28 variant="ghost" size="sm" onClick={() => setIsCommandOpen(true)}>
            <SearchIcon28 className="h-4 w-4" />
          </Button28>

          <Link28 to="/inbox" className="relative">
            <InboxIcon28 className="h-5 w-5" />
            {(unreadData?.count ?? 0) > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                {unreadData!.count}
              </span>
            )}
          </Link28>

          <Button28 variant="ghost" size="sm" onClick={() => setIsNavOpen(true)} className="md:hidden">
            <MenuIcon28 className="h-5 w-5" />
          </Button28>
        </div>

        <AppNavDesktop28 />
        <AppNavMobile28 isOpen={isNavOpen} onClose={() => setIsNavOpen(false)} />
        <CommandMenu28 open={isCommandOpen} onOpenChange={setIsCommandOpen} />
      </div>
    </header>
  );
};
