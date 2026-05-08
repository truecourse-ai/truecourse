/**
 * identical-functions shape that should NOT fire:
 *
 * TanStack `useMutation` option-bag callbacks (onSuccess /
 * onSettled / onError) and other framework-prescribed handler
 * keys naturally have identical shapes across files because
 * the framework dictates the signature and the action
 * (`refetch`, `toast.success`, `navigate`). Each callback
 * closes over its own surrounding mutation, so syntactic
 * match is coincidental.
 */

declare const useMutation: <T, V>(opts: {
  mutationFn: (v: V) => Promise<T>;
  onSuccess?: (data: T) => void;
  onSettled?: () => void;
}) => { mutate: (v: V) => void };

declare const toast: { success: (msg: string) => void };
declare const navigate: (path: string) => void;
declare const refetchAll: () => void;
declare const apiPostName: (v: { name: string }) => Promise<void>;
declare const apiPostEmail: (v: { email: string }) => Promise<void>;

export const useNameMutation = (): { mutate: (v: { name: string }) => void } =>
  useMutation<void, { name: string }>({
    mutationFn: apiPostName,
    onSuccess: () => {
      toast.success("Saved");
      navigate("/dashboard");
      refetchAll();
    },
    onSettled: () => {
      refetchAll();
    },
  });

export const useEmailMutation = (): { mutate: (v: { email: string }) => void } =>
  useMutation<void, { email: string }>({
    mutationFn: apiPostEmail,
    // Same shape as useNameMutation's — coincidental: each closes
    // over its own mutation. Standard TanStack callback contract.
    onSuccess: () => {
      toast.success("Saved");
      navigate("/dashboard");
      refetchAll();
    },
    onSettled: () => {
      refetchAll();
    },
  });
