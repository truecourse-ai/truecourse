declare function useQuery(opts: object): { data: unknown; isLoading: boolean };
declare function createContext<T>(defaultValue: T): object;

const AuthContext = createContext<{ user: unknown }>({ user: null });

export function AuthProvider({ children }: { children: unknown }) {
  const { data: session } = useQuery({ queryKey: ['session'] });

  return null;
}
