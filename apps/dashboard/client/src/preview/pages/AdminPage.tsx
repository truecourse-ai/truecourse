/**
 * Admin, for operators: every workspace on this deployment.
 *
 * The two sections it will hold, the jobs of every workspace and the LLM traces
 * behind them, have no cross-workspace read behind them yet: `/api/jobs` answers
 * for the caller's own workspace and there is no trace endpoint at all. So each
 * says so and shows nothing. A table filled from a fixture would be the one
 * thing an operator console must never do — claim a deployment state nobody
 * measured.
 */

import { ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, SideMenu } from '@/preview/ui/bits';

const BASE = '/preview/admin';

const SECTIONS = {
  jobs: {
    title: 'Jobs across workspaces',
    body: 'The deployment-wide job list is not wired to a source yet. A workspace sees its own jobs on Agent.',
  },
  traces: {
    title: 'LLM traces',
    body: 'The deployment-wide trace store is not wired to a source yet.',
  },
} as const;

export default function AdminPage({ tab = 'jobs' }: { tab?: 'jobs' | 'traces' }) {
  const section = SECTIONS[tab];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Admin" />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Admin sections"
          activeId={tab}
          items={[
            { id: 'jobs', label: 'Jobs', to: BASE },
            { id: 'traces', label: 'Traces', to: `${BASE}/traces` },
          ]}
        />
        <div className="min-h-0 min-w-0 flex-1">
          <EmptyState icon={ShieldCheck} title={section.title} body={section.body} />
        </div>
      </div>
    </div>
  );
}
