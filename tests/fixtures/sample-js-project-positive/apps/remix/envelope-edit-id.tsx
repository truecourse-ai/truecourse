
declare const useLoaderData: <T>() => T;
declare const useParams: () => Record<string, string>;
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useBlocker: (fn: (args: any) => boolean) => { state: string; proceed: () => void; reset: () => void };
declare const EnvelopeEditorRecipientForm: any;
declare const EnvelopeEditorFieldsStep: any;
declare const EnvelopeEditorPreviewPage: any;
declare const Tabs: any;
declare const TabsList: any;
declare const TabsTrigger: any;
declare const TabsContent: any;
declare const Button: any;
declare const AlertDialog: any;
declare const AlertDialogContent: any;
declare const AlertDialogHeader: any;
declare const AlertDialogTitle: any;
declare const AlertDialogDescription: any;
declare const AlertDialogFooter: any;
declare const AlertDialogCancel: any;
declare const AlertDialogAction: any;

type EnvelopeEditLoaderData = {
  envelopeId: string;
  title: string;
  status: string;
  recipients: any[];
  fields: any[];
};

export default function EnvelopeEditPage() {
  const { envelopeId } = useParams();
  const { title, status, recipients, fields } = useLoaderData<EnvelopeEditLoaderData>();
  const [activeTab, setActiveTab] = useState<'recipients' | 'fields' | 'preview'>('recipients');
  const [isDirty, setIsDirty] = useState(false);

  const blocker = useBlocker(({ currentLocation, nextLocation }: any) => {
    return isDirty && currentLocation.pathname !== nextLocation.pathname;
  });

  const handleRecipientsSubmit = async (values: any) => {
    setIsDirty(false);
    setActiveTab('fields');
  };

  const handleFieldsSubmit = async (values: any) => {
    setIsDirty(false);
    setActiveTab('preview');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">Edit envelope · {status}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="h-full">
          <div className="border-b px-6">
            <TabsList className="h-12 rounded-none border-0 bg-transparent p-0">
              <TabsTrigger
                value="recipients"
                className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
              >
                1. Recipients
              </TabsTrigger>
              <TabsTrigger
                value="fields"
                className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
              >
                2. Fields
              </TabsTrigger>
              <TabsTrigger
                value="preview"
                className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
              >
                3. Preview &amp; Send
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="recipients" className="m-0 h-full overflow-auto p-6">
            <div className="mx-auto max-w-2xl">
              <EnvelopeEditorRecipientForm
                envelopeId={envelopeId}
                defaultValues={{ recipients }}
                onSubmit={handleRecipientsSubmit}
              />
            </div>
          </TabsContent>

          <TabsContent value="fields" className="m-0 h-full overflow-hidden">
            <EnvelopeEditorFieldsStep
              envelopeId={envelopeId}
              fields={fields}
              onSubmit={handleFieldsSubmit}
              onBack={() => setActiveTab('recipients')}
              onChange={() => setIsDirty(true)}
            />
          </TabsContent>

          <TabsContent value="preview" className="m-0 h-full overflow-hidden">
            <EnvelopeEditorPreviewPage envelopeId={envelopeId} />
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. If you leave now, your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={blocker.reset}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={blocker.proceed}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}



// FP: enum-field-type-dispatch — comparing field.type against an enum member for branch routing
declare const FieldKind: { SIGNATURE: string; INITIALS: string; TEXT: string; DATE: string };
declare function renderSignatureWidget(field: { type: string; value: string }): void;
declare function renderTextWidget(field: { type: string; value: string }): void;

function dispatchFieldRenderer(fieldItem: { type: string; value: string }) {
  if (fieldItem.type === FieldKind.SIGNATURE) {
    renderSignatureWidget(fieldItem);
  } else {
    renderTextWidget(fieldItem);
  }
}



// FP: enum-field-type-dispatch — comparing activeField against FieldKind enum member to apply CSS class
declare const FieldKind: { SIGNATURE: string; INITIALS: string; DATE: string };
declare const activeField: string;

function getFieldButtonClass(fieldType: string): string {
  return fieldType === FieldKind.SIGNATURE
    ? 'field-btn field-btn--signature field-btn--active'
    : 'field-btn';
}



// FP: enum-field-type-dispatch — comparing selectedField === FieldKind.SIGNATURE for data-selected UI attribute
declare const FieldKind: { SIGNATURE: string; INITIALS: string; TEXT: string; DATE: string; CHECKBOX: string };
declare const selectedField: string;

function buildFieldPickerItem(fieldType: string) {
  return {
    'data-selected': fieldType === FieldKind.SIGNATURE,
    label: fieldType === FieldKind.SIGNATURE ? 'Signature' : 'Other Field',
  };
}



// FP: enum-field-type-dispatch — comparing field.type === FieldKind.SIGNATURE or FREE_SIGNATURE to classify for rendering
declare const FieldKind: { SIGNATURE: string; FREE_SIGNATURE: string; TEXT: string; DATE: string };

function isSignatureKind(fieldType: string): boolean {
  return fieldType === FieldKind.SIGNATURE || fieldType === FieldKind.FREE_SIGNATURE;
}

function renderFieldContent(field: { type: string; value: string }) {
  if (isSignatureKind(field.type)) {
    return { component: 'SignatureDisplay', value: field.value };
  }
  return { component: 'TextDisplay', value: field.value };
}



// FP: enum-field-type-dispatch — filtering fields where field.type !== FieldKind.SIGNATURE for field categorization
declare const FieldKind: { SIGNATURE: string; TEXT: string; DATE: string; CHECKBOX: string };
declare const allFields: Array<{ type: string; id: number }>;

const nonSignatureFields = allFields.filter((field) => field.type !== FieldKind.SIGNATURE);
const signatureFields = allFields.filter((field) => field.type === FieldKind.SIGNATURE);



// FP: enum-field-type-dispatch — comparing activeField === 'SIGNATURE' string literal for CSS class selection in UI
declare const activeField: string;

function getFieldTabClassName(fieldType: string): string {
  const isActive = activeField === 'SIGNATURE';
  return isActive && fieldType === 'SIGNATURE'
    ? 'field-tab field-tab--signature field-tab--selected'
    : 'field-tab';
}



// FP: enum-field-type-dispatch — comparing field.type !== FieldKind.SIGNATURE to branch UI rendering
declare const FieldKind: { SIGNATURE: string; TEXT: string; DATE: string; CHECKBOX: string };
declare function renderSignatureContainer(field: { type: string; id: number }): void;
declare function renderStandardContainer(field: { type: string; id: number }): void;

function renderSigningFieldContainer(field: { type: string; id: number }) {
  if (field.type !== FieldKind.SIGNATURE) {
    renderStandardContainer(field);
    return;
  }
  renderSignatureContainer(field);
}
