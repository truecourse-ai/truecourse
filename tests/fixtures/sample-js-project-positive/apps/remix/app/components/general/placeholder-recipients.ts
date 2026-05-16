
// FP: useCallback returns async function; result of form.setValue is void and discarded.
declare function useCallback3<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function normalizeOrders<T extends { signingOrder: number }>(items: T[]): T[];

type Participant = { id: string; name: string; email: string; signingOrder: number };
type DragEndEvent = { source: { index: number }; destination: { index: number } | null };

declare const participantForm: {
  setValue: (field: string, value: Participant[], opts: { shouldValidate: boolean; shouldDirty: boolean }) => void;
  getValues: () => { participants: Participant[] };
};
declare function handleAutoSave(): Promise<void>;

const onParticipantDragEnd = useCallback3(
  async (result: DragEndEvent) => {
    if (!result.destination) return;

    const items = [...participantForm.getValues().participants];
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved!);

    const reordered = normalizeOrders(items);

    participantForm.setValue('participants', reordered, {
      shouldValidate: true,
      shouldDirty: true,
    });

    void handleAutoSave();
  },
  [],
);



// catch-variable-never-accessed: catch(err) never accessed; block shows fixed toast without touching err
declare function requestEmailVerificationBanner(userId: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleVerifyEmailBanner(userId: string): Promise<void> {
  try {
    await requestEmailVerificationBanner(userId);
    showToast('Verification email sent', 'success');
  } catch (err) {
    showToast('Failed to send verification email. Please try again.', 'error');
  }
}
