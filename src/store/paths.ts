const TENANT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/**
 * A tenant id reaches the filesystem, so it is validated against an allowlist
 * rather than sanitized. Anything with a separator, a dot segment, or a null
 * byte is rejected outright instead of being cleaned up and trusted.
 */
export function assertTenantId(tenant: string): string {
  if (!TENANT_ID.test(tenant)) {
    throw new Error(
      `invalid tenant id "${tenant}": expected 1-64 chars of [a-z0-9_-]`
    )
  }

  return tenant
}

export function tenantDir(root: string, tenant: string): string {
  return `${root}/tenants/${assertTenantId(tenant)}`
}

export function snapshotsDir(root: string, tenant: string): string {
  return `${tenantDir(root, tenant)}/snapshots`
}

export function snapshotFile(
  root: string,
  tenant: string,
  snapshot: string
): string {
  return `${snapshotsDir(root, tenant)}/${snapshot}.tnt`
}

export function currentFile(root: string, tenant: string): string {
  return `${tenantDir(root, tenant)}/current`
}

export function logFile(root: string, tenant: string): string {
  return `${tenantDir(root, tenant)}/log.jsonl`
}

export function lockFile(root: string, tenant: string): string {
  return `${tenantDir(root, tenant)}/lock`
}
