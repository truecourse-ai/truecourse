
// Promise-discard for router navigate() inside callback prop
declare function navigateTo(path: string): Promise<void>;
declare const folderId: string | null;
declare const teamSlug: string;

const onConfirmClick = () => {
  if (folderId) {
    void navigateTo(`/t/${teamSlug}/templates/f/${folderId}`);
  } else {
    void navigateTo(`/t/${teamSlug}/templates`);
  }
};



// Fire-and-forget autosave in event handler callback prop
declare function persistDraftFields(): Promise<void>;

const onFieldResize = (node: HTMLElement, index: number) => {
  // update field dimensions …
  void persistDraftFields();
};



// Intentional promise-discard in callback prop for form submit
declare function submitFieldConfig(): Promise<void>;
declare const DocumentFlowFormContainerActions: (props: { onGoNextClick: () => void; onGoBackClick: () => void; loading: boolean }) => JSX.Element;
declare function prevStep(): void;
declare const isSubmitting: boolean;

const configFooter = (
  <DocumentFlowFormContainerActions
    loading={isSubmitting}
    onGoBackClick={prevStep}
    onGoNextClick={() => void submitFieldConfig()}
  />
);



// Fire-and-forget in useEffect event listener body
declare function reloadSubscriptionLimits(): Promise<void>;
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;

useEffect(() => {
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void reloadSubscriptionLimits();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => document.removeEventListener('visibilitychange', onVisibilityChange);
}, []);



// Promise-discard for react-hook-form trigger() inside callback
declare const form: { trigger(field: string): Promise<boolean> };
declare const isReadOnly: boolean;
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;

useEffect(() => {
  if (isReadOnly) {
    void form.trigger('amount');
  }
}, [isReadOnly]);



// Fire-and-forget tRPC cache invalidation in mutation callback
declare const utils: { document: { attachment: { list: { invalidate(args: { documentId: string }): Promise<void> } } } };
declare const documentId: string;

const onDeleteSuccess = () => {
  void utils.document.attachment.list.invalidate({ documentId });
};



// Promise-discard for navigate() with options in useEffect
declare function navigateTo(path: string, opts?: { replace?: boolean }): Promise<void>;
declare const envelope: { teamId: string; type: string } | null;
declare const team: { id: string; url: string };
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;

useEffect(() => {
  if (!envelope) return;
  if (envelope.teamId !== team.id) {
    void navigateTo(`/${team.url}/documents`, { replace: true });
  }
}, [envelope, team]);



// Fire-and-forget autosave triggered from reorder callback
declare function persistRecipientOrder(): Promise<void>;
declare const recipients: Array<{ id: string; name: string; role: string }>;

const onRecipientReorder = (fromIndex: number, toIndex: number) => {
  const updated = [...recipients];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  void persistRecipientOrder();
};
