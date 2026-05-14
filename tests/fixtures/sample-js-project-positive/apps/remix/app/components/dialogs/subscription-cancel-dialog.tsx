// FP shape: imports from @sample/ui subpaths — a shared UI primitives library
// consumed by apps. These are not cross-service violations; they are the intended
// monorepo pattern for a scoped UI package (name matches /@scope\/ui/).

declare module '@sample/ui/primitives/alert' {
  export const Alert: (props: { children?: unknown; className?: string }) => JSX.Element;
  export const AlertDescription: (props: { children?: unknown }) => JSX.Element;
}

declare module '@sample/ui/primitives/button' {
  export const Button: (props: { onClick?: () => void; disabled?: boolean; children?: unknown }) => JSX.Element;
}

declare module '@sample/ui/primitives/dialog' {
  export const Dialog: (props: { open?: boolean; onOpenChange?: (v: boolean) => void; children?: unknown }) => JSX.Element;
  export const DialogContent: (props: { children?: unknown }) => JSX.Element;
  export const DialogDescription: (props: { children?: unknown }) => JSX.Element;
  export const DialogFooter: (props: { children?: unknown }) => JSX.Element;
  export const DialogHeader: (props: { children?: unknown }) => JSX.Element;
  export const DialogTitle: (props: { children?: unknown }) => JSX.Element;
  export const DialogTrigger: (props: { asChild?: boolean; children?: unknown }) => JSX.Element;
}

declare module '@sample/ui/primitives/use-toast' {
  export function useToast(): { toast: (opts: { title: string; description?: string }) => void };
}

import { Alert, AlertDescription } from '@sample/ui/primitives/alert';
import { Button } from '@sample/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@sample/ui/primitives/dialog';
import { useToast } from '@sample/ui/primitives/use-toast';
import { useState } from 'react';

export type SubscriptionCancelDialogProps = {
  subscriptionId: string;
  planName: string;
  locked: boolean;
  trigger: React.ReactNode;
};

export const SubscriptionCancelDialog = ({
  subscriptionId,
  planName,
  locked,
  trigger,
}: SubscriptionCancelDialogProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const handleCancel = async () => {
    try {
      toast({ title: 'Subscription cancelled successfully.' });
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast({ title: 'Failed to cancel subscription.', description: String(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {planName}?</DialogTitle>
          <DialogDescription>
            This will immediately cancel your {planName} subscription.
          </DialogDescription>
        </DialogHeader>
        {locked && (
          <Alert>
            <AlertDescription>
              This subscription is locked and cannot be cancelled at this time.
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Keep subscription</Button>
          <Button onClick={handleCancel} disabled={locked}>
            Cancel subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};



// --- argument-type-mismatch FP: useMemo wrapping .map() to attach index ---
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;

interface Participant { id: number; email: string; name: string; }

function OrderedParticipantList({ participants }: { participants: Participant[] }) {
  const indexed = useMemo(
    () => participants.map((p, index) => ({ ...p, order: index + 1 })),
    [participants],
  );
  return (
    <ol>
      {indexed.map((p) => (
        <li key={p.id}>{p.order}. {p.name}</li>
      ))}
    </ol>
  );
}



// --- argument-type-mismatch FP: Dialog onOpenChange with boolean guard before setState ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function Dialog(props: { open: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }): JSX.Element;
declare function DialogTrigger(props: { children?: React.ReactNode }): JSX.Element;
declare function DialogContent(props: { children?: React.ReactNode }): JSX.Element;

function ConfirmDeleteModal({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) setOpen(false);
      }}
    >
      <DialogTrigger><button>Delete</button></DialogTrigger>
      <DialogContent><button onClick={onConfirm}>Confirm</button></DialogContent>
    </Dialog>
  );
}



// --- argument-type-mismatch FP: useMemo callback using .find() returning typed item or undefined ---
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;

interface Signer { id: number; email: string; isPrimary: boolean; }

function PrimarySignerBadge({ signers, currentUserId }: { signers: Signer[]; currentUserId: number }) {
  const isPrimary = useMemo(
    () => !!signers.find((s) => s.id === currentUserId && s.isPrimary),
    [signers, currentUserId],
  );
  return isPrimary ? <span>Primary</span> : null;
}



// --- argument-type-mismatch FP: useMemo creating Map from array with tuple entries ---
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;

interface SignatureRecord { fieldId: string; data: string; timestamp: number; }

function SignatureStatusPanel({ signatures }: { signatures: SignatureRecord[] }) {
  const signaturesById = useMemo(
    () => new Map(signatures.map((sig) => [sig.fieldId, sig])),
    [signatures],
  );

  return (
    <div>
      {Array.from(signaturesById.entries()).map(([id, sig]) => (
        <div key={id}>{sig.data}</div>
      ))}
    </div>
  );
}



// --- argument-type-mismatch FP: setState updater with spread + appended item ---
declare function useState<T>(init: T): [T, (fn: (prev: T) => T) => void];

interface ActivityEntry { id: string; text: string; timestamp: number; }

function ActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  function addEntry(text: string) {
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text, timestamp: Date.now() },
    ]);
  }

  return (
    <div>
      <button onClick={() => addEntry('New activity')}>Log</button>
      <ul>{entries.map((e) => <li key={e.id}>{e.text}</li>)}</ul>
    </div>
  );
}



// --- argument-type-mismatch FP: .find() predicate with id equality ---
interface LocalEditorField { formId: string; type: string; value: string; required: boolean; }
interface RemoteField { formId: string; serverValue: string; }

function syncEditorFields(localFields: LocalEditorField[], remoteField: RemoteField): LocalEditorField | undefined {
  return localFields.find((localField) => localField.formId === remoteField.formId);
}



// --- argument-type-mismatch FP: useMemo with early-return empty array for completed state ---
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;

type EnvelopeStatus = 'draft' | 'sent' | 'completed' | 'voided';
interface EnvelopePageField { id: string; x: number; y: number; width: number; height: number; }

function useActivePageFields(
  fields: EnvelopePageField[],
  status: EnvelopeStatus,
): EnvelopePageField[] {
  return useMemo(() => {
    if (status === 'completed' || status === 'voided') {
      return [];
    }
    return fields.filter((f) => f.width > 0 && f.height > 0);
  }, [fields, status]);
}



// Shape: chained filter().map() on array in JSX for conditional rendering — no type mismatch
declare const signers: Array<{ id: number; fields: unknown[]; name: string }>;
declare const groupPrefixId: string;

export function SignerListSnippet() {
  return (
    <div>
      {signers
        .filter((s) => s.fields.length > 0)
        .map((s) => (
          <div key={`${groupPrefixId}-${s.id}`} className="signer-row">
            <span>{s.name}</span>
          </div>
        ))}
    </div>
  );
}



// Shape: createCallable generic with component props and nullable return — valid generic instantiation, no type mismatch
declare function createCallable<TProps, TReturn>(
  component: (opts: TProps & { call: { end: (result: TReturn) => void } }) => JSX.Element,
): (props: TProps) => Promise<TReturn>;

type SelectAttachmentDialogProps = {
  allowedTypes: string[];
  maxCount: number;
};

export const SelectAttachmentDialog = createCallable<SelectAttachmentDialogProps, string[] | null>(
  ({ call, allowedTypes, maxCount }) => (
    <div>
      <button onClick={() => call.end(null)}>Cancel</button>
      <button onClick={() => call.end([])}>Confirm</button>
    </div>
  ),
);



// --- argument-type-mismatch FP: tRPC useMutation onSuccess async callback ---
declare function useApiMutation<TInput, TOutput>(opts: {
  mutationFn: (data: TInput) => Promise<TOutput>;
  onSuccess?: (data: TOutput) => Promise<void> | void;
}): { mutate: (data: TInput) => void };
declare function revalidateCurrentRoute(): Promise<void>;

function ShareLinkToggle({ resourceId }: { resourceId: string }) {
  const { mutate: toggleShareLink } = useApiMutation<{ enabled: boolean }, { shareUrl: string }>({
    mutationFn: async (data) => fetchToggleShareLink(resourceId, data),
    onSuccess: async (data) => {
      await revalidateCurrentRoute();
    },
  });

  return null;
}

declare function fetchToggleShareLink(
  id: string,
  data: { enabled: boolean },
): Promise<{ shareUrl: string }>;



// FP shape f972b15ef14d: Select with field.onChange as onValueChange inside FormControl — no type mismatch
declare function Select(props: { onValueChange: (v: string) => void; children: React.ReactNode } & Record<string, unknown>): JSX.Element;
declare function SelectTrigger(props: { className?: string; children: React.ReactNode }): JSX.Element;
declare function SelectValue(): JSX.Element;
declare function SelectContent(props: { className?: string; position?: string; children: React.ReactNode }): JSX.Element;
declare function SelectItem(props: { key?: unknown; value: string; children: React.ReactNode }): JSX.Element;
declare const ROLE_HIERARCHY: Record<string, string[]>;
declare const ROLE_LABELS: Record<string, string>;
declare const currentRole: string;
declare const _: (msg: string) => string;

function RoleSelectField({ field }: { field: { onChange: (v: string) => void } & Record<string, unknown> }) {
  return (
    <Select {...field} onValueChange={field.onChange}>
      <SelectTrigger className="text-muted-foreground">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-full" position="popper">
        {ROLE_HIERARCHY[currentRole].map((role) => (
          <SelectItem key={role} value={role}>
            {_(ROLE_LABELS[role]) ?? role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}



// FP shape fabbac86177a: Dialog onOpenChange guarded by isSubmitting — no type mismatch
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function Dialog(props: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }): JSX.Element;
declare function DialogTrigger(props: { asChild?: boolean; children: React.ReactNode }): JSX.Element;
declare function DialogContent(props: { position?: string; children: React.ReactNode }): JSX.Element;
declare function Button(props: { variant?: string; children: React.ReactNode }): JSX.Element;

function OrgDeleteDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(value) => !isSubmitting && setOpen(value)}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="destructive">Delete</Button>
        )}
      </DialogTrigger>
      <DialogContent position="center">
        <p>Are you sure you want to delete this organisation?</p>
      </DialogContent>
    </Dialog>
  );
}
