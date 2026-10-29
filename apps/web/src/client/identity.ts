/**
 * Non-sensitive identity snapshot kept in localStorage so that the right local
 * database can be opened offline. No clinical data and no secret is stored here.
 */
export type StoredIdentity = {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  isTraining: boolean;
  userId: string;
  username: string;
  displayName: string;
  title: string | null;
  siteId: string | null;
  siteCode: string | null;
  permissions: string[];
};

const IDENTITY_KEY = 'medhub.identity';
const TENANT_CODE_KEY = 'medhub.tenantCode';

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readIdentity(): StoredIdentity | null {
  const raw = safeStorage()?.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredIdentity;
  } catch {
    return null;
  }
}

export function writeIdentity(identity: StoredIdentity): void {
  safeStorage()?.setItem(IDENTITY_KEY, JSON.stringify(identity));
  safeStorage()?.setItem(TENANT_CODE_KEY, identity.tenantCode);
}

export function clearIdentity(): void {
  safeStorage()?.removeItem(IDENTITY_KEY);
}

export function readTenantCode(): string {
  return safeStorage()?.getItem(TENANT_CODE_KEY) ?? '';
}

export type ServerProfile = {
  user: { id: string; displayName: string; title: string | null; username: string };
  tenant: { id: string; code: string; displayName: string; isTraining: boolean };
  site: { id: string; code: string } | null;
  permissions: string[];
};

export function identityFromProfile(profile: ServerProfile): StoredIdentity {
  return {
    tenantId: profile.tenant.id,
    tenantCode: profile.tenant.code,
    tenantName: profile.tenant.displayName,
    isTraining: profile.tenant.isTraining,
    userId: profile.user.id,
    username: profile.user.username,
    displayName: profile.user.displayName,
    title: profile.user.title,
    siteId: profile.site?.id ?? null,
    siteCode: profile.site?.code ?? null,
    permissions: profile.permissions,
  };
}
