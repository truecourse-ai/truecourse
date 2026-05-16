
// --- FP shape: mutation config callback (onSuccess) that is a method shorthand; type constrained by outer trpc mutation type ---
declare interface NewlyCreatedToken { id: string; token: string }
declare function useState<T>(initial: T | null): [T | null, (v: T | null) => void];
declare const trpc: {
  apiToken: {
    create: {
      useMutation(opts: { onSuccess(data: NewlyCreatedToken): void }): { mutateAsync(args: unknown): Promise<NewlyCreatedToken> }
    }
  }
};

function useCreateTokenForm() {
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<NewlyCreatedToken>(null);

  const { mutateAsync: createTokenMutation } = trpc.apiToken.create.useMutation({
    onSuccess(data) {
      setNewlyCreatedToken(data);
    },
  });

  return { newlyCreatedToken, createTokenMutation };
}



// --- FP shape: mutation config callback (onSuccess) method shorthand in options object; type constrained by outer trpc mutation type ---
declare const trpc2: {
  apiToken: {
    delete: {
      useMutation(opts: { onSuccess(): void }): { mutateAsync(args: { id: string }): Promise<void> }
    }
  }
};
declare function onDelete2(): void;

function useDeleteTokenForm() {
  const { mutateAsync: deleteTokenMutation } = trpc2.apiToken.delete.useMutation({
    onSuccess() {
      onDelete2?.();
    },
  });

  return { deleteTokenMutation };
}



// --- FP shape: React component function returning JSX; trivially inferred, codebase-wide pattern ---
declare function useSession3(): { organisations: Array<{ id: string; name: string }> };
declare function useNavigate3(): (path: string) => void;
declare function useOptionalCurrentTeam(): { id: string; url: string } | null;

declare interface AppCommandMenuProps2 {
  open?: boolean;
  onOpenChange?(_open: boolean): void;
}

export function AppSearchMenu({ open, onOpenChange }: AppCommandMenuProps2) {
  const { organisations } = useSession3();
  const navigate = useNavigate3();
  const currentTeam = useOptionalCurrentTeam();

  return (
    <div role="dialog" aria-modal={open}>
      <ul>
        {organisations.map((org) => (
          <li key={org.id}>
            <button onClick={() => navigate(`/o/${org.id}`)}>{org.name}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
