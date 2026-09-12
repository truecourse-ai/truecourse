/**
 * The workspace's people: the memberships of its WorkOS organization and the
 * invitations that have not been taken up yet.
 *
 * Read live from WorkOS on every request, never a roster stored here, so these
 * shapes are a projection of what the identity provider holds rather than a
 * table of our own.
 */

/** One person in the workspace, as one row of Settings › Members. */
export interface WorkspaceMember {
  /** The organization membership's id, which is what removing one names. */
  id: string
  /** The WorkOS user behind the membership. */
  userId: string
  /** First + last, else the email: the only two things a WorkOS user always has. */
  name: string
  email: string
  /** When the membership was created. */
  joinedAt: string
  /** Whether this is the caller, who can never remove themselves. */
  isSelf: boolean
}

/** An invitation still standing: sent and neither accepted nor revoked. */
export interface WorkspaceInvitation {
  id: string
  email: string
  /** `expired` is an invitation past its date; an accepted or revoked one is not listed. */
  state: 'pending' | 'expired'
  expiresAt: string
  createdAt: string
  /** The address the invited person opens, offered as Copy link. */
  acceptUrl: string
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMember[]
  invitations: WorkspaceInvitation[]
}

/**
 * One workspace the signed-in user belongs to, as the side menu's switcher
 * lists it. A workspace IS a WorkOS organization the user has an active
 * membership in, and the session is minted into exactly one of them.
 */
export interface WorkspaceSummary {
  /** The WorkOS organization id, which is what switching into it names. */
  id: string
  name: string
  /** Whether the session is in this one. */
  current: boolean
}

export interface WorkspacesResponse {
  workspaces: WorkspaceSummary[]
}
