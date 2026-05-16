// FP shape: import from @<scope>/ui/<subpath> — shared monorepo UI library, not a cross-service boundary
declare const celebrationImage: string;
declare const React: { createElement: Function };

declare module '@acme/ui/components/confirmation-card' {
  export interface ConfirmationCardProps {
    className?: string;
    name: string;
    celebrationImage: string;
  }
  export function ConfirmationCard(props: ConfirmationCardProps): JSX.Element;
}

import { ConfirmationCard } from '@acme/ui/components/confirmation-card';

export type DocumentCompletedPageProps = {
  recipientName?: string;
};

export const DocumentCompletedPage = ({ recipientName }: DocumentCompletedPageProps) => {
  return (
    <div className="document--Completed relative mx-auto flex min-h-[100dvh] max-w-screen-lg flex-col items-center justify-center p-6">
      <h3 className="font-semibold text-2xl text-foreground">Document Completed!</h3>
      <div className="mt-8 w-full max-w-md">
        <ConfirmationCard
          className="mx-auto w-full"
          name={recipientName || 'Guest'}
          celebrationImage={celebrationImage}
        />
      </div>
      <p className="mt-8 max-w-[50ch] text-center text-muted-foreground text-sm">
        The document is now complete. Please follow any instructions from the parent application.
      </p>
    </div>
  );
};



// E09: JSX component rendering — correct prop types; no type mismatch.
declare function React_createElement(tag: unknown, props: unknown, ...children: unknown[]): unknown;

interface NoticeItem {
  id: string;
  title: string;
  body: string;
}

declare const NoticeCard: (props: { key: string; notice: NoticeItem }) => unknown;
declare const activeNotices: NoticeItem[];

const noticeElements = activeNotices.map((notice) =>
  React_createElement(NoticeCard, { key: notice.id, notice })
);



// Shape: attachments.map() rendering JSX div per item — standard JSX list, types correct
declare const resources: Array<{ id: string; label: string; url: string }>;
declare function onRemoveResource(id: string): void;

export function ResourceListSnippet() {
  return (
    <div>
      {resources.map((resource) => (
        <div
          key={resource.id}
          className="resource-row"
        >
          <a href={resource.url}>{resource.label}</a>
          <button onClick={() => onRemoveResource(resource.id)}>Remove</button>
        </div>
      ))}
    </div>
  );
}


// Non-route component using useQuery — root boundary covers all cascade errors
declare function useQuery<T>(opts: { queryKey: unknown[]; enabled?: boolean }): { data: T | undefined; isLoading: boolean };

type InvoiceRow = { id: string; amount: number; status: string; date: string };

export function OrgInvoicesPanel({ orgId }: { orgId: string }) {
  const { data, isLoading } = useQuery<{ items: InvoiceRow[] }>({ queryKey: ['invoices', orgId], enabled: Boolean(orgId) });
  const items = data?.items ?? [];
  if (isLoading) return null;
  return <ul>{items.map((inv) => <li key={inv.id}>{inv.date} — {inv.amount}</li>)}</ul>;
}

