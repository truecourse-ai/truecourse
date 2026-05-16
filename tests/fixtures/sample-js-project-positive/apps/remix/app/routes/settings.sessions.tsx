
// FF26 — DateTime.fromJSDate accepting Date; Luxon-style API, no type mismatch
declare const DateTime: { fromJSDate(date: Date): { toRelative(): string | null } };
type SessionRow = { original: { lastActiveAt: Date; createdAt: Date } };

function formatSessionTime(row: SessionRow): string {
  return DateTime.fromJSDate(row.original.lastActiveAt).toRelative() ?? 'unknown';
}



// --- argument-type-mismatch FP: tRPC onSuccess async navigate callback ---
declare function useOrgMutation<TInput>(opts: {
  mutationFn: (data: TInput) => Promise<void>;
  onSuccess?: () => Promise<void> | void;
}): { mutate: (data: TInput) => void };
declare function useNavigate(): (path: string) => Promise<void>;
declare function buildOrgLoginPath(orgUrl: string): string;

function SsoConfirmationForm({
  orgUrl,
  token,
}: {
  orgUrl: string;
  token: string;
}) {
  const navigate = useNavigate();
  const { mutate: confirmSso } = useOrgMutation({
    mutationFn: async (data: { token: string }) => fetchConfirmSso(data),
    onSuccess: async () => {
      await navigate(buildOrgLoginPath(orgUrl));
    },
  });

  return null;
}

declare function fetchConfirmSso(data: { token: string }): Promise<void>;
