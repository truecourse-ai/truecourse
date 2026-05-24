/**
 * Positive fixture for bugs/deterministic/function-return-type-varies.
 *
 * Discriminated-union return shape using `as const`. Each path returns an
 * object literal with a shared `state` discriminator and a different set of
 * payload fields. The compiler infers a literal-typed union here, and the
 * shape is consistent at every call site via narrowing on the discriminator
 * — treating this as "inconsistent return types" is a false positive.
 */

type LoaderArgs = { params: { token?: string }; viewerId: string | null };
type Record = { id: string; ownerId: string };

declare function findRecord(token: string): Promise<Record | null>;

export async function loader({ params, viewerId }: LoaderArgs) {
  if (!params.token) {
    return { state: 'InvalidLink' } as const;
  }

  const record = await findRecord(params.token);
  if (!record) {
    return { state: 'InvalidLink' } as const;
  }

  if (record.ownerId !== viewerId) {
    return {
      state: 'LoginRequired',
      recordId: record.id,
    } as const;
  }

  return {
    state: 'Success',
    recordId: record.id,
    ownerId: record.ownerId,
  } as const;
}
