// Imported and called by @myapp/trpc/server/team-router/delete-team.ts
// dead-module rule fails to follow cross-package alias @myapp/lib

export interface TransferEnvelopesInput {
  fromTeamId: string;
  toTeamId: string;
  envelopeIds?: string[];
}

export async function transferTeamEnvelopes(input: TransferEnvelopesInput): Promise<{ transferred: number }> {
  const count = await moveEnvelopesBetweenTeams(input);
  return { transferred: count };
}

declare function moveEnvelopesBetweenTeams(input: TransferEnvelopesInput): Promise<number>;
