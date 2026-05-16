
declare function useForm<T>(opts: { defaultValues: T; resolver?: unknown }): { getValues: () => T };
declare const ZParticipantSchema: { parse: (v: unknown) => unknown };

type ParticipantField = { id: number; slotId: number; email?: string; roleId: number; meta?: unknown };
type Participant = { id: number; email: string };

type FormValues = { participants: ParticipantField[] };

declare const participants: Participant[];
declare const existingFields: ParticipantField[];

const participantForm = useForm<FormValues>({
  defaultValues: {
    participants: existingFields.map((field) => ({
      nativeId: field.id,
      formId: `${field.id}-${field.slotId}`,
      roleId: field.roleId,
      assigneeEmail: participants.find((p) => p.id === field.id)?.email ?? '',
      fieldMeta: field.meta ? ZParticipantSchema.parse(field.meta) : undefined,
    })),
  },
});
