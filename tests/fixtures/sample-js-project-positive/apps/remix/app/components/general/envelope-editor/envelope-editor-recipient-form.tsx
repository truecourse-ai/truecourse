declare function nanoid(size: number): string;
declare const RecipientRole: { SIGNER: string };
declare function appendRecipient(data: Record<string, any>): void;
declare const currentSigners: Array<{ signingOrder: number }>;

function onAddRecipient() {
  appendRecipient({
    formId: nanoid(12),
    name: '',
    email: '',
    role: RecipientRole.SIGNER,
    actionAuth: [],
    signingOrder: currentSigners.length > 0
      ? (currentSigners[currentSigners.length - 1]?.signingOrder ?? 0) + 1
      : 1,
  });
}


declare const useForm: (opts: unknown) => { register: (name: string, opts?: unknown) => unknown; handleSubmit: (fn: (data: unknown) => void) => (e: React.FormEvent) => void; formState: { errors: Record<string, { message?: string }>; isSubmitting: boolean } };
declare const Button: (props: { children: React.ReactNode; type?: string; disabled?: boolean; variant?: string }) => JSX.Element;
declare const Input: (props: { id?: string; type?: string; placeholder?: string; disabled?: boolean } & Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const Select: (props: { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }) => JSX.Element;
declare const SelectTrigger: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const SelectContent: (props: { children: React.ReactNode }) => JSX.Element;
declare const SelectItem: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const SelectValue: (props: { placeholder?: string }) => JSX.Element;
declare const useToast: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const addRecipientToEnvelope: (envelopeId: string, data: unknown) => Promise<void>;

type RecipientRole = 'signer' | 'viewer' | 'approver';

type AddRecipientFormProps = {
  envelopeId: string;
  onAdded: () => void;
  onCancel: () => void;
};

export function AddRecipientForm({ envelopeId, onAdded, onCancel }: AddRecipientFormProps) {
  const { toast } = useToast();
  const [role, setRole] = React.useState<RecipientRole>('signer');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({});

  const onSubmit = handleSubmit(async (data) => {
    try {
      await addRecipientToEnvelope(envelopeId, { ...data, role });
      toast({ title: 'Recipient added' });
      onAdded();
    } catch {
      toast({ title: 'Failed to add recipient', variant: 'destructive' });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rec-add-name">Name</Label>
        <Input
          id="rec-add-name"
          placeholder="Full name"
          disabled={isSubmitting}
          {...register('name', { required: 'Name is required' })}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rec-add-email">Email</Label>
        <Input
          id="rec-add-email"
          type="email"
          placeholder="recipient@example.com"
          disabled={isSubmitting}
          {...register('email', { required: 'Email is required' })}
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v as RecipientRole)}>
          <SelectTrigger>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="signer">Signer</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
            <SelectItem value="approver">Approver</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add recipient'}</Button>
      </div>
    </form>
  );
}


declare const DragDropContext: (props: { onDragEnd: (result: unknown) => void; children: React.ReactNode }) => JSX.Element;
declare const Droppable: (props: { droppableId: string; children: (provided: { droppableProps: Record<string, unknown>; innerRef: React.Ref<HTMLDivElement> }) => JSX.Element }) => JSX.Element;
declare const Draggable: (props: { key?: string; draggableId: string; index: number; isDragDisabled?: boolean; children: (provided: { innerRef: React.Ref<HTMLDivElement>; draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown> }, snapshot: { isDragging: boolean }) => JSX.Element }) => JSX.Element;
declare const motion: { fieldset: (props: { 'data-native-id'?: string; disabled?: boolean; className?: string; children: React.ReactNode }) => JSX.Element };
declare const cn: (...args: unknown[]) => string;

type SignerDraft = {
  id: string;
  nativeId: string;
  name: string;
  email: string;
  role: string;
  signingOrder?: number;
};

type RecipientListEditorProps = {
  signers: SignerDraft[];
  isSubmitting: boolean;
  isSigningOrderSequential: boolean;
  onDragEnd: (result: unknown) => void;
  canRecipientBeModified: (id: string) => boolean;
  onRemove: (id: string) => void;
  children?: (signer: SignerDraft) => React.ReactNode;
};

export function RecipientListEditor({
  signers,
  isSubmitting,
  isSigningOrderSequential,
  onDragEnd,
  canRecipientBeModified,
  onRemove,
  children,
}: RecipientListEditorProps) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="signers">
        {(provided) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            className="flex w-full flex-col gap-y-2"
          >
            {signers.map((signer, index) => (
              <Draggable
                key={`${signer.nativeId}-${signer.signingOrder}`}
                draggableId={signer.nativeId}
                index={index}
                isDragDisabled={
                  !isSigningOrderSequential ||
                  isSubmitting ||
                  !canRecipientBeModified(signer.id) ||
                  !signer.signingOrder
                }
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={cn('py-1', {
                      'pointer-events-none rounded-md bg-widget-foreground pt-2': snapshot.isDragging,
                    })}
                  >
                    <motion.fieldset
                      data-native-id={signer.id}
                      disabled={isSubmitting || !canRecipientBeModified(signer.id)}
                      className={cn('pb-2')}
                    >
                      {children ? children(signer) : (
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium">{signer.name}</p>
                          <p className="text-xs text-muted-foreground">{signer.email}</p>
                          <p className="text-xs text-muted-foreground capitalize">{signer.role}</p>
                        </div>
                      )}
                    </motion.fieldset>
                  </div>
                )}
              </Draggable>
            ))}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}



declare const DragDropContext3: React.FC<{ onDragEnd: (result: unknown) => void; sensors?: unknown[]; children?: React.ReactNode }>;
declare const Droppable3: React.FC<{ droppableId: string; children: (provided: { droppableProps: Record<string, unknown>; innerRef: React.Ref<HTMLDivElement>; placeholder: React.ReactNode }) => React.ReactNode }>;
declare const Draggable3: React.FC<{ key: string; draggableId: string; index: number; isDragDisabled?: boolean; children: (provided: { innerRef: React.Ref<HTMLDivElement>; draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown> }, snapshot: { isDragging: boolean }) => React.ReactNode }>;
declare const cn3: (...classes: (string | undefined | false | null)[]) => string;
declare const React: { FC: unknown; ReactNode: unknown; Ref: unknown; MutableRefObject: unknown };
declare type SensorAPI2 = unknown;

type RecipientDragListProps = {
  recipients: Array<{ id: string; email: string; role: string; signingOrder?: number; isDirectRecipient?: boolean }>;
  isSequentialOrder: boolean;
  isSubmitting: boolean;
  canModifyRecipient: (id: string) => boolean;
  onDragEnd: (result: unknown) => void;
  renderRecipientRow: (recipient: RecipientDragListProps['recipients'][number], index: number) => React.ReactNode;
  sensorApiRef: React.Ref<SensorAPI2>;
};

export const RecipientDragList = ({
  recipients,
  isSequentialOrder,
  isSubmitting,
  canModifyRecipient,
  onDragEnd,
  renderRecipientRow,
  sensorApiRef,
}: RecipientDragListProps) => {
  return (
    <DragDropContext3
      onDragEnd={onDragEnd}
      sensors={[
        (api: SensorAPI2) => {
          (sensorApiRef as { current: SensorAPI2 }).current = api;
        },
      ]}
    >
      <Droppable3 droppableId="recipients">
        {(provided) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef as React.Ref<HTMLDivElement>}
            className="flex w-full flex-col gap-y-2"
          >
            {recipients.map((recipient, index) => (
              <Draggable3
                key={`${recipient.id}-${recipient.signingOrder}`}
                draggableId={recipient.id}
                index={index}
                isDragDisabled={
                  !isSequentialOrder ||
                  isSubmitting ||
                  recipient.isDirectRecipient ||
                  !recipient.signingOrder
                }
              >
                {(innerProvided, snapshot) => (
                  <div
                    ref={innerProvided.innerRef as React.Ref<HTMLDivElement>}
                    {...innerProvided.draggableProps}
                    {...innerProvided.dragHandleProps}
                    className={cn3('py-1', {
                      'rounded-md bg-muted pt-2': snapshot.isDragging,
                    })}
                  >
                    {renderRecipientRow(recipient, index)}
                  </div>
                )}
              </Draggable3>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable3>
    </DragDropContext3>
  );
};
