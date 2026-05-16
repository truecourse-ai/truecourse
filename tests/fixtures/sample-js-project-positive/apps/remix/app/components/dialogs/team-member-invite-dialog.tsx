
// FP: Mixed import where the value side (CsvParser) is legitimately used at runtime;
// the `type ParseOptions` inline specifier is correct — rule incorrectly flags this pattern.
//
// Simulating: import CsvParser, { type ParseOptions } from 'some-csv-parser';
// We must use declare const to avoid real import statements.
declare const CsvParser: {
  parse: <T>(input: string | File, options?: unknown) => void;
  unparse: (data: unknown[], options?: unknown) => string;
};
declare type CsvParseOptions = {
  header: boolean;
  skipEmptyLines: boolean;
  complete: (results: { data: Array<Record<string, string>>; errors: Array<{ message: string }> }) => void;
  error: (error: Error) => void;
};

type TeamMemberInviteRowData = {
  email: string;
  role: string;
};

function parseCsvInviteFile(
  csvFile: File,
  onComplete: (rows: TeamMemberInviteRowData[]) => void,
  onError: (message: string) => void,
): void {
  const options: CsvParseOptions = {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const errors = results.errors;
      if (errors.length > 0) {
        onError(errors.map((e) => e.message).join('; '));
        return;
      }

      const rows: TeamMemberInviteRowData[] = results.data
        .map((row) => ({
          email: (row['email'] ?? '').trim().toLowerCase(),
          role: (row['role'] ?? 'MEMBER').trim().toUpperCase(),
        }))
        .filter((row) => row.email.length > 0);

      onComplete(rows);
    },
    error: (error) => {
      onError(error.message);
    },
  };

  // CsvParser is a runtime value — not just a type; correct to import as value
  CsvParser.parse(csvFile, options);
}

function downloadInviteTemplate(): void {
  const csv = CsvParser.unparse(
    [{ email: 'alice@example.com', role: 'MEMBER' }],
    { header: true },
  );

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'invite-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}



// FP shape: TEAM_DOCUMENT_VISIBILITY_MAP is a Record keyed by TeamMemberRole enum;
// teamRole is typed TeamMemberRole. Enum-exhaustive Record lookup.
declare const enum TeamMemberRole { ADMIN = 'ADMIN', MANAGER = 'MANAGER', MEMBER = 'MEMBER' }
declare const enum DocumentVisibility { EVERYONE = 'EVERYONE', TEAM_AND_ADMINS = 'TEAM_AND_ADMINS', ADMIN = 'ADMIN' }

const TEAM_ROLE_VISIBILITY_MAP = {
  [TeamMemberRole.ADMIN]: [DocumentVisibility.EVERYONE, DocumentVisibility.TEAM_AND_ADMINS, DocumentVisibility.ADMIN],
  [TeamMemberRole.MANAGER]: [DocumentVisibility.EVERYONE, DocumentVisibility.TEAM_AND_ADMINS],
  [TeamMemberRole.MEMBER]: [DocumentVisibility.EVERYONE],
} satisfies Record<TeamMemberRole, DocumentVisibility[]>;

function getAllowedVisibilities(teamRole: TeamMemberRole): DocumentVisibility[] {
  return TEAM_ROLE_VISIBILITY_MAP[teamRole];
}
