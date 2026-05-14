export function ProperDeps(): JSX.Element { return <div>loaded</div>; }
export function AccessibleDataTable(): JSX.Element {
  return (<table><thead><tr><th>Data</th></tr></thead><tbody><tr><td>Row</td></tr></tbody></table>);
}
export function SvgIcon(): JSX.Element {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>;
}


// FP: async event handler with return in try vs implicit undefined in catch.
// Return value is never consumed by the caller (onClick handler);
// mixed return in async event handlers is intentional.
declare const authClient: { signOut: () => Promise<void> };
declare function deleteUserAccount(): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

const onDeleteAccount = async (): Promise<void> => {
  try {
    await deleteUserAccount();
    showToast({ title: 'Account deleted', description: 'Your account has been removed.' });
    return await authClient.signOut();
  } catch {
    showToast({
      title: 'Something went wrong',
      description: 'Unable to delete your account. Please try again later.',
      variant: 'destructive',
    });
  }
};



// FP: dialog component (non-route) that uses useQuery.
// Boundary responsibility belongs at the enclosing route or root layout;
// root ErrorBoundary covers all unhandled errors in child components.
declare function useQuery<T>(opts: object): { data: T | undefined; isLoading: boolean };
interface ReportTemplate { id: string; name: string; fields: string[] }

export function ReportTemplatePreviewDialog({
  templateId,
  open,
  onOpenChange,
}: {
  templateId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}): JSX.Element {
  const { data: template } = useQuery<ReportTemplate>({ queryKey: ['report-template', templateId] });
  return <div>{open && template?.name}</div>;
}

