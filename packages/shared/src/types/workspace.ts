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

/**
 * An invite link still standing: created and neither redeemed nor revoked.
 * Unlike an invitation it names no email — whoever opens it joins.
 */
export interface WorkspaceInviteLink {
  id: string
  /** The address to share: the invite page on this app, carrying the token. */
  url: string
  /** `expired` is a link past its date; a redeemed or revoked one is not listed. */
  state: 'pending' | 'expired'
  expiresAt: string
  createdAt: string
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMember[]
  invitations: WorkspaceInvitation[]
  inviteLinks: WorkspaceInviteLink[]
}

/**
 * What the invite page shows before the visitor decides to join: the
 * workspace's name and who sent the link, nothing else of the workspace's.
 * Whoever holds the link is not in it yet, so its members and repositories
 * stay behind the gate.
 */
export interface InviteLinkPreview {
  workspaceName: string
  /** The sender's display name; null when WorkOS could not say. */
  inviterName: string | null
  expiresAt: string
}

/**
 * Why an invite cannot be redeemed, as the public routes say it. The first
 * three are the link's own state; `elsewhere` is the visitor's — signed in to
 * another workspace, in an edition where a person is in one.
 */
export const INVITE_LINK_REFUSALS = ['invalid', 'used', 'expired', 'elsewhere'] as const
export type InviteLinkRefusal = (typeof INVITE_LINK_REFUSALS)[number]

/** The lifetimes an invite link may be given, in days: what the dialog offers and the server accepts. */
export const INVITE_LINK_DAYS = [1, 3, 7, 14, 30] as const
export type InviteLinkDays = (typeof INVITE_LINK_DAYS)[number]

/** One invite link as the store holds it. */
export interface WorkspaceInviteLinkRecord {
  id: string
  workspaceOrgId: string
  token: string
  inviterUserId: string
  /** The sender's display name when the link was minted; null when they had none. */
  inviterName: string | null
  expiresAt: string
  createdAt: string
  consumedAt: string | null
  consumedByUserId: string | null
}

/**
 * The invite links a workspace has issued. The contract lives here, like the
 * repositories', because the data store implements it and the auth routes
 * consume it while neither owns the other.
 */
export interface WorkspaceInviteLinkStore {
  create(link: {
    workspaceOrgId: string
    inviterUserId: string
    inviterName: string | null
    expiresAt: string
  }): Promise<WorkspaceInviteLinkRecord>
  /** The links not yet redeemed, expired ones included: those are rows until revoked. */
  listOpen(workspaceOrgId: string): Promise<WorkspaceInviteLinkRecord[]>
  findByToken(token: string): Promise<WorkspaceInviteLinkRecord | null>
  /**
   * Redeem the link for one user, atomically: answers the row when this call
   * won it, null when it was already redeemed, expired or never existed.
   */
  consume(token: string, userId: string): Promise<WorkspaceInviteLinkRecord | null>
  /** Undo a consume that gave nobody a seat, so the link stands again. */
  release(id: string): Promise<void>
  /** Revoke one of this workspace's links; false when it holds no such link. */
  delete(workspaceOrgId: string, id: string): Promise<boolean>
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

/**
 * WHAT THE WORKSPACE'S PRODUCT IS, in one sentence.
 *
 * The workspace states it; nothing derives it. It is the ONLY subject the
 * Document scan attributes a document against — "is this doc about OUR product
 * or someone else's?" has no answer without a statement of what ours is, and a
 * curator asked that question with no subject substitutes one out of whatever
 * the document names. A workspace holding several repositories has no single
 * name to stand in either, and code is often connected after the documentation,
 * so the connected repositories are least able to say it exactly when
 * attribution needs it said.
 *
 * It is therefore REQUIRED: a workspace states it at creation, and until it has
 * one nothing may be connected into it (see {@link WORKSPACE_DESCRIPTION_REQUIRED}).
 */

/**
 * The bound on any product description that reaches a prompt. The scan's
 * identity block is built from it, and the classifier needs "what kind of
 * system is this", not the pitch.
 */
export const PRODUCT_DESCRIPTION_MAX_CHARS = 400

/** Short of this, it is a keystroke rather than a statement of what a product is. */
export const WORKSPACE_DESCRIPTION_MIN_CHARS = 10

/** What the routes say when a description is asked for and not given. */
export const BAD_WORKSPACE_DESCRIPTION = `Say what this workspace's product is, in one sentence (${WORKSPACE_DESCRIPTION_MIN_CHARS}–${PRODUCT_DESCRIPTION_MAX_CHARS} characters).`

/**
 * The refusal code every entry point that brings material into a workspace
 * answers with while the workspace has no description: connecting a repository,
 * adding a documentation source, and the scan itself. The client reads it and
 * sends the person to Settings › Workspace rather than showing a dead end.
 */
export const WORKSPACE_DESCRIPTION_REQUIRED = 'workspace-description-required'

/**
 * A description as it may be stored, or null when it is not one. The single
 * reduction: whitespace collapsed, then the bounds. Every writer uses it, so
 * the form, the two creation routes and the profile route agree on what counts.
 */
export function normalizeWorkspaceDescription(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (text.length < WORKSPACE_DESCRIPTION_MIN_CHARS) return null
  if (text.length > PRODUCT_DESCRIPTION_MAX_CHARS) return null
  return text
}

/** Settings › Workspace: what this workspace says its product is. */
export interface WorkspaceProfileResponse {
  /** Null until it has been set — which no route that connects anything allows. */
  description: string | null
  updatedAt: string | null
}
