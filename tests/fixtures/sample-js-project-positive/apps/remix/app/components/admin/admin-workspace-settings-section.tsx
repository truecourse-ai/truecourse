
declare const useLingui16: () => { _: (msg: unknown) => string };
declare const WORKSPACE_VISIBILITY16: Record<string, { value: unknown }>;
declare const ZWorkspaceEmailSettingsSchema16: { safeParse: (data: unknown) => { success: boolean; data?: Record<string, boolean> } };
declare const DetailsCard16: React.ComponentType<{ label: React.ReactNode; children: React.ReactNode }>;
declare const DetailsValue16: React.ComponentType<{ children: React.ReactNode }>;
declare const msg16: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;

type TWorkspaceEmailSettings16 = Record<string, boolean>;

const EMAIL_SETTINGS_LABELS16: Record<keyof TWorkspaceEmailSettings16, unknown> = {
  memberSigningRequest: msg16`Member signing request`,
  memberRemoved: msg16`Member removed`,
  memberSigned: msg16`Member signed`,
  documentPending: msg16`Document pending`,
  documentCompleted: msg16`Document completed`,
  documentDeleted: msg16`Document deleted`,
  ownerDocumentCompleted: msg16`Owner document completed`,
  ownerMemberExpired: msg16`Owner member expired`,
  ownerDocumentCreated: msg16`Owner document created`,
};

const emailSettingsKeys16 = Object.keys(EMAIL_SETTINGS_LABELS16) as (keyof TWorkspaceEmailSettings16)[];

type WorkspaceGlobalSettings16 = {
  documentVisibility?: string | null;
  documentLanguage?: string | null;
  documentTimezone?: string | null;
  brandingName?: string | null;
  brandingEnabled?: boolean | null;
  emailDocumentSettings?: unknown;
};

type AdminWorkspaceSettingsSectionProps16 = {
  settings: WorkspaceGlobalSettings16 | null;
  isTeam?: boolean;
};

export const AdminWorkspaceSettingsSection16 = ({ settings, isTeam = false }: AdminWorkspaceSettingsSectionProps16) => {
  const { _ } = useLingui16();
  const notSetLabel = isTeam ? 'Inherited' : 'Not set';

  if (!settings) {
    return null;
  }

  const textValue = (value: string | null | undefined): React.ReactNode => {
    if (value === null || value === undefined) return notSetLabel;
    return value;
  };

  const brandingTextValue = (value: string | null | undefined): React.ReactNode => {
    if (value === null || value === undefined || value.trim() === '') return notSetLabel;
    return value;
  };

  const booleanValue = (value: boolean | null | undefined): React.ReactNode => {
    if (value === null || value === undefined) return notSetLabel;
    return value ? 'Enabled' : 'Disabled';
  };

  const parsedEmailSettings = ZWorkspaceEmailSettingsSchema16.safeParse(settings.emailDocumentSettings);

  return (
    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <DetailsCard16 label="Document visibility">
        <DetailsValue16>
          {settings.documentVisibility != null
            ? _(WORKSPACE_VISIBILITY16[settings.documentVisibility]?.value)
            : notSetLabel}
        </DetailsValue16>
      </DetailsCard16>

      <DetailsCard16 label="Document language">
        <DetailsValue16>{textValue(settings.documentLanguage)}</DetailsValue16>
      </DetailsCard16>

      <DetailsCard16 label="Document timezone">
        <DetailsValue16>{textValue(settings.documentTimezone)}</DetailsValue16>
      </DetailsCard16>

      <DetailsCard16 label="Branding name">
        <DetailsValue16>{brandingTextValue(settings.brandingName)}</DetailsValue16>
      </DetailsCard16>

      <DetailsCard16 label="Branding enabled">
        <DetailsValue16>{booleanValue(settings.brandingEnabled)}</DetailsValue16>
      </DetailsCard16>

      {parsedEmailSettings.success && parsedEmailSettings.data &&
        emailSettingsKeys16.map((key) => (
          <DetailsCard16 key={key} label={_(EMAIL_SETTINGS_LABELS16[key])}>
            <DetailsValue16>{booleanValue(parsedEmailSettings.data![key])}</DetailsValue16>
          </DetailsCard16>
        ))}
    </div>
  );
};



// FP shape: groupedRows[currentGroupedIndex] is always initialized to [row] before .push() is called;
// the else branch is only reached when the array slot already exists. Index is always valid by construction.
declare type TAuditRow = { groupKey: string; timestamp: number; action: string; actorId: string };

function groupAuditRows(rows: TAuditRow[]): TAuditRow[][] {
  const grouped: TAuditRow[][] = [];
  const keyToIndex = new Map<string, number>();

  for (const row of rows) {
    const existingIndex = keyToIndex.get(row.groupKey);
    if (existingIndex === undefined) {
      const newIndex = grouped.length;
      keyToIndex.set(row.groupKey, newIndex);
      grouped.push([row]);
    } else {
      grouped[existingIndex].push(row);
    }
  }

  return grouped;
}
