
declare const useLoaderData: <T>() => T;
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare function useState<T>(init: T): [T, (v: T) => void];
declare const Link: any;
declare const DataTable: any;
declare const Input: any;
declare const Select: any;
declare const SelectContent: any;
declare const SelectItem: any;
declare const SelectTrigger: any;
declare const SelectValue: any;
declare const Button: any;
declare const FilePlus: any;
declare const Search: any;

type DocumentRow = {
  id: string;
  title: string;
  status: string;
  recipientCount: number;
  createdAt: string;
  updatedAt: string;
};

type DocumentsIndexLoaderData = {
  documents: DocumentRow[];
  totalCount: number;
  page: number;
  perPage: number;
};

export default function DocumentsIndexPage() {
  const { documents, totalCount, page, perPage } = useLoaderData<DocumentsIndexLoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (searchQuery) {
      next.set('q', searchQuery);
    } else {
      next.delete('q');
    }
    next.set('page', '1');
    setSearchParams(next);
  };

  const handleStatusFilter = (status: string) => {
    const next = new URLSearchParams(searchParams);
    if (status && status !== 'ALL') {
      next.set('status', status);
    } else {
      next.delete('status');
    }
    next.set('page', '1');
    setSearchParams(next);
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            {totalCount} document{totalCount !== 1 ? 's' : ''}
          </p>
        </div>

        <Button asChild>
          <Link to="/documents/new">
            <FilePlus className="mr-2 h-4 w-4" />
            New Document
          </Link>
        </Button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search documents…"
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <Select
          value={searchParams.get('status') ?? 'ALL'}
          onValueChange={handleStatusFilter}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={documents}
        totalCount={totalCount}
        page={page}
        perPage={perPage}
      />
    </div>
  );
}



// FP: client-side-form-validation — .trim() !== '' presence check on a UI form field, not a secret comparison
declare function showFieldError(msg: string): void;

function validateSignaturePresence(signatureValue: string): boolean {
  if (signatureValue.trim() !== '') {
    return true;
  }
  showFieldError('Signature is required');
  return false;
}



// FP: boolean-config-flag-or-length-check — comparing isSignatureValid === false (boolean state) to show UI error
declare function showValidationBanner(msg: string): void;

function checkAndShowSignaturePadError(isSignatureValid: boolean) {
  if (isSignatureValid === false) {
    showValidationBanner('Please draw or type your signature before continuing.');
  }
}



// FP: enum-field-type-dispatch — comparing field.type against FieldKind.SIGNATURE for field routing/display logic
declare const FieldKind: { SIGNATURE: string; TEXT: string; DATE: string; DROPDOWN: string };
declare function renderSignatureInput(field: { type: string; id: number }): void;
declare function renderStandardInput(field: { type: string; id: number }): void;

function renderDirectTemplateField(field: { type: string; id: number }) {
  if (field.type === FieldKind.SIGNATURE) {
    renderSignatureInput(field);
  } else {
    renderStandardInput(field);
  }
}



// FP: client-side-form-validation — .trim() !== '' check on a user-provided signature string for form presence validation
declare function setFormError(field: string, msg: string): void;

function validateSignatureField(signatureInput: string): boolean {
  if (signatureInput.trim() !== '') {
    return true;
  }
  setFormError('signature', 'Please provide a signature before proceeding.');
  return false;
}



// FP: client-side-form-validation — checking clientSecret === '' to gate form submission; presence check, not crypto compare
declare function showFormValidationError(fieldName: string, msg: string): void;

function validateSsoConfigForm(formValues: { clientId: string; clientSecret: string; issuerUrl: string }): boolean {
  if (formValues.clientSecret === '') {
    showFormValidationError('clientSecret', 'Client secret is required');
    return false;
  }
  if (formValues.clientId === '') {
    showFormValidationError('clientId', 'Client ID is required');
    return false;
  }
  return true;
}
