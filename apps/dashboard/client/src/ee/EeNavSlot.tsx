/**
 * Renders the nav links contributed by the enterprise client module
 * (e.g. Workspace), already capability-filtered by EeModuleContext.
 * Empty in community mode. `iconName` strings are mapped to icons here
 * so the contract stays framework-free.
 */

import { Link, useLocation } from 'react-router-dom';
import { Building2, type LucideIcon } from 'lucide-react';
import { useEeModule } from '@/ee/EeModuleContext';

const ICONS: Record<string, LucideIcon> = { Building2 };

export function EeNavSlot() {
  const { navItems } = useEeModule();
  const { pathname } = useLocation();
  if (navItems.length === 0) return null;

  return (
    <>
      {navItems.map((item) => {
        const Icon = item.iconName ? ICONS[item.iconName] : undefined;
        const active = pathname === item.to;
        return (
          <Link
            key={item.id}
            to={item.to}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
