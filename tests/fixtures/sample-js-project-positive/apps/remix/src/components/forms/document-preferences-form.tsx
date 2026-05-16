
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];
declare function useEffect(fn: () => (() => void) | void, deps: unknown[]): void;
declare const cn: (...classes: (string | undefined | false | null)[]) => string;
declare function useOrganisationSettings(): { canInherit: boolean; currentOrgId: string; teamId?: string };
declare const FormField: (props: { control: unknown; name: string; render: (args: { field: { value: unknown; onChange: (v: unknown) => void } }) => unknown }) => unknown;
declare const FormItem: (props: { className?: string; children?: unknown }) => unknown;
declare const FormLabel: (props: { children?: unknown }) => unknown;
declare const FormDescription: (props: { children?: unknown }) => unknown;
declare const Select: (props: { value: string; onValueChange: (v: string) => void; children?: unknown }) => unknown;
declare const SelectTrigger: (props: { children?: unknown }) => unknown;
declare const SelectValue: (props?: unknown) => unknown;
declare const SelectContent: (props: { children?: unknown }) => unknown;
declare const SelectItem: (props: { value: string; children?: unknown }) => unknown;
declare const MultiSelectCombobox: (props: { listValues: unknown[]; onChange: (v: unknown) => void; scopeId?: string }) => unknown;

export const RecipientDefaultsSection = ({
  form,
}: {
  form: { control: unknown; formState: { errors: Record<string, unknown> } };
}) => {
  const { canInherit, currentOrgId, teamId } = useOrganisationSettings();

  const renderAuditLogField = ({ field }: { field: { value: string | null; onChange: (v: string | null) => void } }) => {
    return FormItem({
      children: [
        FormLabel({ children: 'Audit Log Visibility' }),
        canInherit && Select({
          value: field.value === null ? '-1' : '0',
          onValueChange: (value: string) => field.onChange(value === '-1' ? null : 'HIDE'),
          children: [
            SelectTrigger({ children: SelectValue() }),
            SelectContent({
              children: [
                SelectItem({ value: '-1', children: 'Inherit from organisation' }),
                SelectItem({ value: '0', children: 'Override organisation settings' }),
              ],
            }),
          ],
        }),
        FormDescription({ children: 'Controls whether the audit logs will be included when downloading the document.' }),
      ],
    });
  };

  const renderDefaultRecipientsField = ({ field }: { field: { value: unknown[] | null; onChange: (v: unknown) => void } }) => {
    const recipients = field.value ?? [];

    return FormItem({
      className: 'flex-1',
      children: [
        FormLabel({ children: 'Default Recipients' }),
        canInherit && Select({
          value: field.value === null ? '-1' : '0',
          onValueChange: (value: string) => field.onChange(value === '-1' ? null : []),
          children: [
            SelectTrigger({ children: SelectValue() }),
            SelectContent({
              children: [
                SelectItem({ value: '-1', children: 'Inherit from organisation' }),
                SelectItem({ value: '0', children: 'Override organisation settings' }),
              ],
            }),
          ],
        }),
        (field.value !== null || !canInherit) && MultiSelectCombobox({
          listValues: recipients as unknown[],
          onChange: field.onChange,
          scopeId: !canInherit ? currentOrgId : teamId,
        }),
      ],
    });
  };

  return [
    FormField({ control: form.control, name: 'auditLogVisibility', render: renderAuditLogField }),
    FormField({ control: form.control, name: 'defaultRecipients', render: renderDefaultRecipientsField }),
  ];
};



declare function useState<T>(init: T): [T, (v: T) => void];
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: unknown[]): T;
declare const cn: (...classes: (string | undefined | false | null)[]) => string;
declare const GripVertical: unknown;
declare function useRecipientForm(): {
  signers: Array<{ id: string; disabled?: boolean }>;
  control: unknown;
  errors: { signers?: Array<{ signingOrder?: unknown }> };
  isSigningOrderEnabled: boolean;
  isSubmitting: boolean;
};
declare function useDragSensors(api: unknown): void;
declare const SensorAPI: unknown;

export const ConfigureRecipientsPanel = () => {
  const {
    signers,
    control,
    errors,
    isSigningOrderEnabled,
    isSubmitting,
  } = useRecipientForm();

  const [sensorApiRef, setSensorApiRef] = useState<unknown>(null);

  const onDragEnd = useCallback((result: { source: { index: number }; destination: { index: number } | null }) => {
    if (!result.destination) {
      return;
    }

    const from = result.source.index;
    const to = result.destination.index;

    if (from === to) {
      return;
    }

    // reorder signers array by swapping positions
    const reordered = [...signers];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    return reordered;
  }, [signers]);

  const draggableItems = useMemo(() => {
    return signers.map((signer, index) => ({
      key: signer.id,
      draggableId: signer.id,
      index,
      isDragDisabled: !isSigningOrderEnabled || isSubmitting || !!signer.disabled,
      content: (provided: unknown, snapshot: { isDragging: boolean }) => ({
        ref: provided,
        className: cn('py-1', {
          'pointer-events-none rounded-md bg-widget-foreground pt-2': snapshot.isDragging,
        }),
        children: {
          className: cn('flex items-end gap-2 pb-2', {
            'border-destructive/50': errors?.signers?.[index],
          }),
          signingOrderField: isSigningOrderEnabled ? {
            control,
            name: `signers.${index}.signingOrder`,
            containerClass: cn('flex w-16 flex-none items-center gap-x-1', {
              'mb-6': errors?.signers?.[index] && !errors?.signers?.[index]?.signingOrder,
            }),
          } : null,
        },
      }),
    }));
  }, [signers, isSigningOrderEnabled, isSubmitting, errors, control]);

  return { draggableItems, onDragEnd, sensorApiRef, setSensorApiRef };
};



declare function useRef2<T>(init: T): { current: T };
declare function useEffect2(fn: () => (() => void) | void, deps: unknown[]): void;
declare function useCallback2<T extends (...args: any[]) => any>(fn: T, deps: unknown[]): T;
declare const ZRecipientsFormSchema: { safeParse: (data: unknown) => { success: boolean; data?: unknown } };
declare function useEnvelopeData(): {
  envelope: { documentMeta: { signingOrder: string; allowDictateNextSigner: boolean } };
  recipients: Array<{ id: string; signingOrder?: number }>;
  canRecipientBeModified: (id: string) => boolean;
};
declare const DocumentSigningOrder: { PARALLEL: string; SEQUENTIAL: string };
declare const RecipientRole: { ASSISTANT: string; SIGNER: string };

export const useRecipientFormSync = (form: {
  setValue: (key: string, value: unknown, opts?: object) => void;
  trigger: () => Promise<void>;
  watch: (key: string) => unknown;
}) => {
  const { envelope, recipients, canRecipientBeModified } = useEnvelopeData();
  const isFirstRender = useRef2(true);

  const formValues = form.watch('signers') as Array<{ id: string; role: string; signingOrder?: number }>;

  const resetToParallelOrder = useCallback2(() => {
    const updatedSigners = (formValues ?? []).map((signer: { id: string; role: string; signingOrder?: number }) => ({
      ...signer,
      role: signer.role === RecipientRole.ASSISTANT ? RecipientRole.SIGNER : signer.role,
    }));

    form.setValue('signers', updatedSigners, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue('signingOrder', DocumentSigningOrder.PARALLEL, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue('allowDictateNextSigner', false, {
      shouldValidate: true,
      shouldDirty: true,
    });

    void form.trigger();
  }, [form, formValues]);

  useEffect2(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const validated = ZRecipientsFormSchema.safeParse(formValues);

    if (!validated.success) {
      return;
    }

    const data = validated.data as { signers: Array<{ id: string; signingOrder?: number }>; signingOrder: string; allowDictateNextSigner: boolean };

    const envelopeRecipients = data.signers.map((recipient: { id: string; signingOrder?: number }) => {
      if (!canRecipientBeModified(recipient.id)) {
        return {
          ...recipient,
          signingOrder: recipient.signingOrder,
        };
      }
      return recipient;
    });

    const hasSigningOrderChanged = envelope.documentMeta.signingOrder !== data.signingOrder;
    const hasAllowDictateChanged = envelope.documentMeta.allowDictateNextSigner !== data.allowDictateNextSigner;

    const hasSignersChanged =
      envelopeRecipients.length !== recipients.length ||
      envelopeRecipients.some((signer: { id: string; signingOrder?: number }) => {
        const recipient = recipients.find((r) => r.id === signer.id);
        return !recipient;
      });

    const hasChanged = hasSigningOrderChanged || hasAllowDictateChanged || hasSignersChanged;

    if (!hasChanged) {
      return;
    }

    void form.trigger();
  }, [formValues, envelope, recipients, canRecipientBeModified, form]);

  return { resetToParallelOrder };
};
