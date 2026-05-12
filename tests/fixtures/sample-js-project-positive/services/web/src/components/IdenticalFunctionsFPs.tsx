// Mode 1: trivial-inline-jsx-callbacks — short one-liner setState callbacks in JSX.
declare const setOpen: (v: boolean) => void;
declare const onOpenChange: (v: boolean) => void;
declare const setRowSelectionDocs: (v: Record<string, boolean>) => void;
declare const setRowSelectionTemplates: (v: Record<string, boolean>) => void;

export function MemberInviteDialogCancelButton(): JSX.Element {
  return <button onClick={() => setOpen(false)}>Cancel</button>;
}

export function EnvelopeDeleteDialogCancelButton(): JSX.Element {
  return <button onClick={() => onOpenChange(false)}>Cancel</button>;
}

export function DocumentsBulkActionBarClear(): JSX.Element {
  return <button onClick={() => setRowSelectionDocs({})}>Clear</button>;
}

export function TemplatesBulkActionBarClear(): JSX.Element {
  return <button onClick={() => setRowSelectionTemplates({})}>Clear</button>;
}

// Mode 2: radix-ui-event-boilerplate — preventDefault one-liners on DropdownMenuItem.
type RadixSelectEvent = { preventDefault: () => void; stopPropagation: () => void };
declare const DropdownMenuItem: (props: {
  onSelect?: (e: RadixSelectEvent) => void;
  children?: unknown;
}) => JSX.Element;

export function DocumentPageViewDropdownDeleteItem(): JSX.Element {
  return <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Delete</DropdownMenuItem>;
}

export function SignerHeaderDropdownDeleteItem(): JSX.Element {
  return <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Remove</DropdownMenuItem>;
}

export function WebhooksSettingsDropdownDeleteItem(): JSX.Element {
  return <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Revoke</DropdownMenuItem>;
}

// Mode 3: document-template-parallel-flows — mirrored handlers in sibling flow files.
type FieldType = "SIGNATURE" | "DATE" | "TEXT";
declare const setSelectedFieldDocument: (t: FieldType) => void;
declare const setSelectedFieldTemplate: (t: FieldType) => void;
declare const utilsDocumentGetSetData: (
  key: { documentId: string },
  merge: (prev: unknown) => unknown,
) => void;
declare const utilsTemplateGetByIdSetData: (
  key: { templateId: string },
  merge: (prev: unknown) => unknown,
) => void;
declare const mergePartial: (prev: unknown) => unknown;
declare const documentId: string;
declare const templateId: string;

export function DocumentFlowAddSignatureButton(): JSX.Element {
  return <button onClick={() => setSelectedFieldDocument("SIGNATURE")}>Signature</button>;
}

export function TemplateFlowAddSignatureButton(): JSX.Element {
  return <button onClick={() => setSelectedFieldTemplate("SIGNATURE")}>Signature</button>;
}

export function documentEditFormOnSuccess(): void {
  utilsDocumentGetSetData({ documentId }, mergePartial);
}

export function templateEditFormOnSuccess(): void {
  utilsTemplateGetByIdSetData({ templateId }, mergePartial);
}

// Mode 4: idiomatic-rhf-form-adapters — react-hook-form onChange coercion repeats.
type FormField<T> = { onChange: (value: T) => void };
type ChangeEvent = { target: { value: string } };
declare const subscriptionCountField: FormField<number>;
declare const organisationMemberCountField: FormField<number>;
declare const documentPreferenceSelectField: FormField<string | null>;
declare const SelectInput: (props: {
  onValueChange: (v: string) => void;
  children?: unknown;
}) => JSX.Element;

export function SubscriptionClaimCountInput(): JSX.Element {
  return (
    <input
      type="number"
      onChange={(e: ChangeEvent) =>
        subscriptionCountField.onChange(parseInt(e.target.value, 10) || 0)
      }
    />
  );
}

export function AdminOrganisationsMemberCountInput(): JSX.Element {
  return (
    <input
      type="number"
      onChange={(e: ChangeEvent) =>
        organisationMemberCountField.onChange(parseInt(e.target.value, 10) || 0)
      }
    />
  );
}

export function DocumentPreferencesNullableSelect(): JSX.Element {
  return (
    <SelectInput
      onValueChange={(value: string) =>
        documentPreferenceSelectField.onChange(value === "-1" ? null : value)
      }
    >
      <span>Default</span>
    </SelectInput>
  );
}

// Mode 5: same-component-intentional-repetition-or-artifact — sibling stubs/mutations
// in one component file with distinct semantic roles.
export abstract class BaseJobClient {
  schedule(): never {
    throw new Error("Not implemented");
  }
  cancel(): never {
    throw new Error("Not implemented");
  }
}

type Row<T> = { getValue: <K extends keyof T>(key: K) => T[K] };
type OrganisationInsightsRow = { memberCount: number; documentCount: number };

export const memberCountCell = ({ row }: { row: Row<OrganisationInsightsRow> }): number =>
  Number(row.getValue("memberCount"));

export const documentCountCell = ({ row }: { row: Row<OrganisationInsightsRow> }): number =>
  Number(row.getValue("documentCount"));

declare const invalidateAttachments: () => Promise<void>;

export const onAttachmentCreateSuccess = async (): Promise<void> => {
  await invalidateAttachments();
};

export const onAttachmentDeleteSuccess = async (): Promise<void> => {
  await invalidateAttachments();
};
