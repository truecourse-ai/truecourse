
declare const Link: any;
declare const useLocation: () => { pathname: string };
declare const cn: (...args: any[]) => string;
declare const LayoutDashboard: any;
declare const FileText: any;
declare const Users: any;
declare const Settings: any;
declare const Bell: any;
declare const HelpCircle: any;
declare const LogOut: any;
declare const useCurrentUser: () => { name: string; email: string; avatarUrl?: string };
declare const Avatar: any;
declare const AvatarFallback: any;
declare const AvatarImage: any;

type NavItem = {
  href: string;
  label: string;
  icon: any;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppNavDesktop() {
  const { pathname } = useLocation();
  const user = useCurrentUser();

  return (
    <nav className="hidden w-64 flex-col border-r bg-background lg:flex">
      <div className="flex h-16 items-center border-b px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="text-lg">MyApp</span>
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto border-t p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatarUrl} />
            <AvatarFallback>
              {user.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <Link
            to="/help"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <HelpCircle className="h-4 w-4" />
            Help
          </Link>

          <Link
            to="/logout"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Link>
        </div>
      </div>
    </nav>
  );
}
