
// Lingui i18n tagged-template call pattern — no type mismatch
declare function _(msg: any): string;
declare function msg(strings: TemplateStringsArray, ...values: any[]): any;

function buildTableColumns() {
  return [
    {
      header: () => _(msg`Status`),
      accessorKey: 'status',
    },
    {
      header: () => _(msg`Owner`),
      accessorKey: 'owner',
    },
    {
      header: () => _(msg`Team`),
      accessorKey: 'teamName',
    },
  ];
}



// _(msg`Created`) — Lingui _ with tagged template literal, correct usage, no type mismatch
declare function _(msg: any): string;
declare function msg(strings: TemplateStringsArray, ...values: any[]): any;

function getColumnHeaders() {
  return [
    _(msg`Created`),
    _(msg`Updated`),
    _(msg`Completed`),
  ];
}



// --- argument-type-mismatch FP: useMemo with class instantiation inside ---
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare class DeviceParser { getBrowser(): { name?: string }; getOS(): { name?: string }; }

function UserAgentDisplay({ userAgentString }: { userAgentString: string }) {
  const deviceInfo = useMemo(() => {
    const parser = new DeviceParser();
    return [
      parser.getBrowser().name ?? 'Unknown Browser',
      parser.getOS().name ?? 'Unknown OS',
    ];
  }, [userAgentString]);
  return <span>{deviceInfo.join(' / ')}</span>;
}



// --- argument-type-mismatch FP: setErrors with filtered string arrays ---
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];

interface ValidationErrors { email?: string[]; name?: string[]; }

function ContactForm() {
  const [errors, setErrors] = useState<ValidationErrors>({});

  function handleBlur(field: 'email' | 'name', value: string) {
    const fieldErrors = value.trim() === '' ? [`${field} is required`] : [];
    setErrors({ ...errors, [field]: fieldErrors.filter(Boolean) });
  }

  return (
    <form>
      <input onBlur={(e) => handleBlur('email', e.target.value)} />
      {errors.email?.map((err) => <p key={err}>{err}</p>)}
    </form>
  );
}



// --- argument-type-mismatch FP: optional .map() constructing normalized objects ---
interface CheckboxOption { value: string; checked?: boolean; label?: string; }

function normalizeCheckboxOptions(
  rawOptions: Array<{ value: string; checked?: boolean; label?: string }> | undefined,
): CheckboxOption[] {
  return (
    rawOptions?.map((opt) => ({
      value: opt.value.trim(),
      checked: opt.checked ?? false,
      label: opt.label ?? opt.value,
    })) ?? []
  );
}


// --- argument-type-mismatch FP: children(table) render prop call; valid render prop pattern, no type mismatch ---
declare const React_createElement5: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;

interface TableInstance { rows: unknown[]; columns: unknown[] }

interface DataTableProps {
  data: unknown[];
  children?: (table: TableInstance) => unknown;
}

function DataTableWrapper({ data, children }: DataTableProps) {
  const table: TableInstance = { rows: data, columns: [] };

  return React_createElement5(
    'div',
    { className: 'data-table-wrapper' },
    children ? children(table) : null,
  );
}



// --- argument-type-mismatch FP: records.map with JSX key prop from record field ---
declare const dnsRecords: Array<{ name: string; type: string; value: string; ttl: number }>;

function DnsRecordList() {
  return (
    <div>
      {dnsRecords.map((record) => (
        <div key={record.name}>
          <span>{record.type}</span>
          <span>{record.value}</span>
          <span>{record.ttl}s</span>
        </div>
      ))}
    </div>
  );
}
