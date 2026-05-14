
// FF21 — JSX form onSubmit={handleSubmit(onFormSubmit)} react-hook-form pattern
type SendFormValues = { subject: string; message: string };
declare const handleSubmit: (onValid: (data: SendFormValues) => void) => (e: Event) => void;
declare function onFormSubmit(data: SendFormValues): void;

function SendEnvelopeForm() {
  return (
    <form onSubmit={handleSubmit(onFormSubmit)}>
      <button type="submit">Send</button>
    </form>
  );
}



// FF34 — SelectItem value prop receives string ID; expected type is string, no mismatch
declare function SelectItem(props: { value: string; children: unknown }): JSX.Element;
type SenderEmail = { id: string; email: string; label: string };
declare const senderEmails: SenderEmail[];

function SenderSelector() {
  return (
    <>
      {senderEmails.map((email) => (
        <SelectItem key={email.id} value={email.id}>
          {email.label}
        </SelectItem>
      ))}
    </>
  );
}



// --- argument-type-mismatch FP: tRPC useMutation onSuccess with returned data callback ---
declare function useTemplateMutation<TInput, TOutput>(opts: {
  mutationFn: (data: TInput) => Promise<TOutput>;
  onSuccess?: (result: TOutput) => void;
}): { mutate: (data: TInput) => void };
declare function useTemplateRouter(): { invalidate: () => void };

interface TemplateUpdateResult {
  id: string;
  title: string;
  updatedAt: string;
}

function TemplateEditForm({ templateId }: { templateId: string }) {
  const router = useTemplateRouter();
  const { mutate: updateTemplate } = useTemplateMutation<{ title: string }, TemplateUpdateResult>({
    mutationFn: async (data) => fetchUpdateTemplate(templateId, data),
    onSuccess: (newData) => {
      router.invalidate();
    },
  });

  return null;
}

declare function fetchUpdateTemplate(
  id: string,
  data: { title: string },
): Promise<TemplateUpdateResult>;



// --- argument-type-mismatch FP: useCallback with string-to-number conversion ---
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useState<T>(init: T): [T, (updater: T | ((prev: T) => T)) => void];

interface Signer {
  id: string;
  name: string;
  signingOrder: number;
}

function SigningOrderManager({ signers }: { signers: Signer[] }) {
  const [localSigners, setLocalSigners] = useState(signers);

  const handlePriorityChange = useCallback(
    (index: number, newPriorityString: string) => {
      const trimmed = newPriorityString.trim();
      if (!trimmed) {
        return;
      }

      const newPriority = Number(trimmed);
      if (!Number.isInteger(newPriority) || newPriority < 1) {
        return;
      }

      const currentSigners = localSigners;
      const signer = currentSigners[index];
      const remaining = currentSigners.filter((_, idx) => idx !== index);
      const newPosition = Math.min(Math.max(0, newPriority - 1), currentSigners.length - 1);
      remaining.splice(newPosition, 0, signer);
      setLocalSigners(remaining.map((s, idx) => ({ ...s, signingOrder: idx + 1 })));
    },
    [localSigners],
  );

  return null;
}
