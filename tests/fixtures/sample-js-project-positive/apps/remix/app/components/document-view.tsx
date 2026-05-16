
// --- react-readonly-props FP: string literal union prop ---
interface DocumentViewProps {
  type?: 'document' | 'template';
  title: string;
  onClose?: () => void;
}

function DocumentView({ type = 'document', title, onClose }: DocumentViewProps) {
  return <div className={`view-${type}`}><h2>{title}</h2></div>;
}


// Route module with useQuery; errors bubble to root layout; route-specific wrapper not required
declare function useQuery<T>(opts: { queryKey: unknown[] }): { data: T | undefined; isLoading: boolean };
interface DomainEntry { id: string; name: string; verified: boolean }

export function AdminDomainPage({ domainId }: { domainId: string }): JSX.Element {
  const { data: domain } = useQuery<DomainEntry>({ queryKey: ['domain', domainId] });
  return <div>{domain?.name ?? 'Loading...'}</div>;
}

