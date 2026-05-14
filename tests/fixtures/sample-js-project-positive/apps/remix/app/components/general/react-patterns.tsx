
// --- void-zero-argument FP shape: event-handler-callback-promise-discard ---
// void asyncFn() inside JSX event handler is intentional fire-and-forget, not void 0
declare function saveFormData(payload: Record<string, unknown>): Promise<void>;

function AutoSaveForm({ formData }: { formData: Record<string, unknown> }) {
  async function handleAutoSave() {
    await saveFormData(formData);
  }

  return (
    <input
      type="text"
      onChange={() => void handleAutoSave()}
    />
  );
}



// --- void-zero-argument FP shape: useeffect-body-promise-discard ---
// void refreshLimits() inside useEffect body is intentional fire-and-forget, not void 0
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function fetchUploadLimits(): Promise<{ maxSize: number; remaining: number }>;
declare function useState<T>(init: T): [T, (v: T) => void];

function FileUploadButton({ userId }: { userId: string }) {
  const [limits, setLimits] = useState<{ maxSize: number; remaining: number } | null>(null);

  async function refreshLimits() {
    const data = await fetchUploadLimits();
    setLimits(data);
  }

  useEffect(() => {
    void refreshLimits();
  }, [userId]);

  return <button disabled={!limits}>Upload</button>;
}



// --- void-zero-argument FP shape: promise-chain-void-discard (void copy(...).then(...)) ---
// void copy(...).then(...) is intentional fire-and-forget clipboard copy with toast feedback
declare function copyToClipboard(text: string): Promise<void>;
declare function showToast(message: string): void;

function RecipientAvatarWithCopy({ email, displayName }: { email: string; displayName: string }) {
  return (
    <div>
      <span>{displayName}</span>
      <button
        onClick={() => void copyToClipboard(email).then(() => showToast('Email copied'))}
      >
        Copy email
      </button>
    </div>
  );
}



// --- void-zero-argument FP shape: async-cleanup-resource-teardown ---
// void pdfViewer.destroy() is intentional fire-and-forget cleanup on unmount, not void 0
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useRef<T>(init: T | null): { current: T | null };

interface PdfViewerInstance {
  render: (container: HTMLElement, url: string) => Promise<void>;
  destroy: () => Promise<void>;
}

declare function createPdfViewer(): PdfViewerInstance;

function PdfViewer({ url }: { url: string }) {
  const viewerRef = useRef<PdfViewerInstance>(null);
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const viewer = createPdfViewer();
    viewerRef.current = viewer;
    if (containerRef.current) {
      void viewer.render(containerRef.current, url);
    }
    return () => {
      if (viewerRef.current) {
        void viewerRef.current.destroy();
      }
    };
  }, [url]);

  return <div ref={containerRef as unknown as never} />;
}




// --- too-many-lines FP shape: react-tsx-component with JSX markup and hooks inflating line count ---
// Standard React component whose length comes from JSX structure and hook wiring, not decomposable logic.
declare function useQuery<T>(opts: { queryKey: unknown[]; queryFn: () => Promise<T> }): { data: T | undefined; isLoading: boolean };
declare function useToast(): { toast: (opts: { title: string; description: string; variant?: string; duration?: number }) => void };
declare function useMutation2<TInput>(opts: { mutationFn: (input: TInput) => Promise<void>; onSuccess?: () => Promise<void>; onError?: () => void }): { mutateAsync: (input: TInput) => Promise<void>; isPending: boolean; isSuccess: boolean };
declare function refreshUserSession(): Promise<void>;
declare function fetchPendingInvites(opts: { status: string }): Promise<Array<{ id: string; token: string; team: { name: string; slug: string; avatarId: string | null } }>>;
declare function formatAvatarSrc(avatarId: string | null): string;
declare const AnimateWrapper: React.ComponentType<{ children: React.ReactNode }>;
declare const FadeInOut: React.ComponentType<{ children: React.ReactNode }>;
declare const InfoBanner: React.ComponentType<{ variant?: string; className?: string; children: React.ReactNode }>;
declare const BannerBody: React.ComponentType<{ className?: string; children: React.ReactNode }>;
declare const NotificationIcon: React.ComponentType<{ className?: string }>;
declare const Modal: React.ComponentType<{ children: React.ReactNode }>;
declare const ModalTrigger: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const ModalContent: React.ComponentType<{ children: React.ReactNode }>;
declare const ModalHeader: React.ComponentType<{ children: React.ReactNode }>;
declare const ModalTitle: React.ComponentType<{ children: React.ReactNode }>;
declare const ModalDescription: React.ComponentType<{ className?: string; children: React.ReactNode }>;
declare const AvatarCard: React.ComponentType<{ avatarSrc: string; avatarFallback: string; primaryText: React.ReactNode; secondaryText: string; className?: string; rightSideComponent?: React.ReactNode }>;
declare const ActionButton: React.ComponentType<{ onClick?: () => void; loading?: boolean; disabled?: boolean; variant?: string; children: React.ReactNode }>;

export const TeamInvitationsBanner = ({ className }: { className?: string }) => {
  const { data, isLoading } = useQuery<Array<{ id: string; token: string; team: { name: string; slug: string; avatarId: string | null } }>>({ 
    queryKey: ['team-invitations', 'pending'],
    queryFn: () => fetchPendingInvites({ status: 'PENDING' }),
  });

  return (
    <AnimateWrapper>
      {data && data.length > 0 && !isLoading && (
        <FadeInOut>
          <InfoBanner variant="secondary" className={className}>
            <div className="flex h-full flex-row items-center p-2">
              <NotificationIcon className="mr-4 h-5 w-5 text-blue-800" />

              <BannerBody className="mr-2">
                {data.length === 1
                  ? <span>You have <strong>1</strong> pending team invitation</span>
                  : <span>You have <strong>{data.length}</strong> pending team invitations</span>
                }
              </BannerBody>

              <Modal>
                <ModalTrigger asChild>
                  <button className="ml-auto font-medium text-blue-700 text-sm hover:text-blue-600">
                    View invites
                  </button>
                </ModalTrigger>

                <ModalContent>
                  <ModalHeader>
                    <ModalTitle>Pending team invitations</ModalTitle>

                    <ModalDescription className="mt-4">
                      {data.length === 1
                        ? <span>You have <strong>1</strong> pending team invitation</span>
                        : <span>You have <strong>{data.length}</strong> pending team invitations</span>
                      }
                    </ModalDescription>
                  </ModalHeader>

                  <ul className="-mx-6 -mb-6 max-h-[80vh] divide-y overflow-auto px-6 pb-6">
                    {data.map((invite) => (
                      <li key={invite.id}>
                        <InfoBanner variant="neutral" className="p-0 px-4">
                          <AvatarCard
                            avatarSrc={formatAvatarSrc(invite.team.avatarId)}
                            className="w-full max-w-none py-4"
                            avatarFallback={invite.team.name.slice(0, 1)}
                            primaryText={
                              <span className="font-semibold text-foreground/80">{invite.team.name}</span>
                            }
                            secondaryText={`/t/${invite.team.slug}`}
                            rightSideComponent={
                              <div className="ml-auto space-x-2">
                                <DeclineInviteButton token={invite.token} />
                                <AcceptInviteButton token={invite.token} />
                              </div>
                            }
                          />
                        </InfoBanner>
                      </li>
                    ))}
                  </ul>
                </ModalContent>
              </Modal>
            </div>
          </InfoBanner>
        </FadeInOut>
      )}
    </AnimateWrapper>
  );
};

const AcceptInviteButton = ({ token }: { token: string }) => {
  const { toast } = useToast();

  const {
    mutateAsync: acceptInvite,
    isPending,
    isSuccess,
  } = useMutation2({
    mutationFn: async (input: { token: string }) => {
      await acceptTeamInvite(input);
    },
    onSuccess: async () => {
      await refreshUserSession();
      toast({
        title: 'Success',
        description: 'Invitation accepted',
        duration: 5000,
      });
    },
    onError: () => {
      toast({
        title: 'Something went wrong',
        description: 'Unable to join this team at this time.',
        variant: 'destructive',
        duration: 10000,
      });
    },
  });

  return (
    <ActionButton
      onClick={async () => acceptInvite({ token })}
      loading={isPending}
      disabled={isPending || isSuccess}
    >
      Accept
    </ActionButton>
  );
};

declare function acceptTeamInvite(input: { token: string }): Promise<void>;
declare function declineTeamInvite(input: { token: string }): Promise<void>;

const DeclineInviteButton = ({ token }: { token: string }) => {
  const { toast } = useToast();

  const {
    mutateAsync: declineInvite,
    isPending,
    isSuccess,
  } = useMutation2({
    mutationFn: async (input: { token: string }) => {
      await declineTeamInvite(input);
    },
    onSuccess: async () => {
      await refreshUserSession();
      toast({
        title: 'Success',
        description: 'Invitation declined',
        duration: 5000,
      });
    },
    onError: () => {
      toast({
        title: 'Something went wrong',
        description: 'Unable to decline this invitation at this time.',
        variant: 'destructive',
        duration: 10000,
      });
    },
  });

  return (
    <ActionButton
      onClick={async () => declineInvite({ token })}
      loading={isPending}
      disabled={isPending || isSuccess}
      variant="ghost"
    >
      Decline
    </ActionButton>
  );
};


// React Query useQuery does NOT throw during render by default — it returns isLoadingError state.
// Error is handled via isLoadingError prop on the table; no ErrorBoundary is needed here.
declare function useQuery5(opts: object): { data: { items: object[]; totalCount: number } | undefined; isLoadingError: boolean };
declare function DataTable5(props: { data: object[]; isLoadingError: boolean }): JSX.Element;

export function AuditLogTable({ page }: { page: number }) {
  const { data, isLoadingError } = useQuery5({ queryKey: ['audit-logs', page] });
  return <DataTable5 data={data?.items ?? []} isLoadingError={isLoadingError} />;
}

