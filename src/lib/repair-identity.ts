export interface AuthenticatedRepairIdentity {
  email: string
  name?: string | null
}

/**
 * Resolve the requester recorded on a repair-related stock transaction.
 * The caller-controlled request body is intentionally not part of this API.
 */
export function resolveRepairRequester(
  identity: AuthenticatedRepairIdentity,
): string {
  const displayName = identity.name?.trim()
  return displayName || identity.email
}
