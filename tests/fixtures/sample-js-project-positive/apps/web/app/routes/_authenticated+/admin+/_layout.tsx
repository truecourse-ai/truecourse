
declare const cn: (...args: any[]) => string;
declare function useLocation(): { pathname: string };
declare const Link: any;

function SettingsAdminNav() {
  const { pathname } = useLocation();

  return [
    {
      className: cn('justify-start w-full', pathname?.startsWith('/admin/overview') && 'bg-secondary'),
      to: '/admin/overview',
      label: 'Overview',
    },
    {
      className: cn('justify-start w-full', pathname?.startsWith('/admin/users') && 'bg-secondary'),
      to: '/admin/users',
      label: 'Users',
    },
    {
      className: cn('justify-start w-full', pathname?.startsWith('/admin/billing') && 'bg-secondary'),
      to: '/admin/billing',
      label: 'Billing',
    },
  ];
}
