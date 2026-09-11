/**
 * Home: the product owner's dashboard, which is not built yet.
 *
 * The repositories moved to Code, where an engineer reads them, and nothing of
 * the workspace has taken their place here. So this page says exactly that and
 * shows nothing else: a home that invented a number, or repeated Code's table
 * under another name, would be worse than an empty one.
 */

import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/preview/ui/bits';
import { PREVIEW_BASE } from '@/preview/shell/base';

export default function HomePage() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Home" />
      <div className="min-h-0 flex-1">
        <EmptyState
          icon={Home}
          title="Home"
          body={
            <>
              The product owner's Home is coming; your repositories are on{' '}
              <Link to={`${PREVIEW_BASE}/code`} className="text-primary hover:underline">
                Code
              </Link>
              .
            </>
          }
        />
      </div>
    </div>
  );
}
