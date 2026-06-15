import 'isomorphic-fetch';
import { ClientSecretCredential } from '@azure/identity';
import { Client, PageCollection, ResponseType } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import {
  AnalysisResult,
  PrivilegedRole,
  SignInRecord,
  UserDevice,
  UserLicense,
  UserProfile,
} from './types';
import { getSignInsFromLogAnalytics } from './logAnalytics';

const MAX_SIGNINS = parseInt(process.env.MAX_SIGNINS || '1000', 10);

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId?: string; // optional Log Analytics Workspace ID for 90+ day history
}

// Active credentials in memory. Seeded from .env, but can be overridden at
// runtime through the settings panel in the UI.
let credentials: GraphCredentials = {
  tenantId: process.env.AZURE_TENANT_ID || '',
  clientId: process.env.AZURE_CLIENT_ID || '',
  clientSecret: process.env.AZURE_CLIENT_SECRET || '',
  workspaceId: process.env.LOG_ANALYTICS_WORKSPACE_ID || '',
};

let cachedClient: Client | null = null;
let cachedKey = '';

/** Sets/updates the Service Principal credentials at runtime. */
export function setCredentials(creds: GraphCredentials): void {
  credentials = {
    tenantId: creds.tenantId.trim(),
    clientId: creds.clientId.trim(),
    clientSecret: creds.clientSecret,
    workspaceId: (creds.workspaceId || '').trim(),
  };
  cachedClient = null; // force client recreation with the new credentials
}

/** Returns the active credentials (internal use, e.g. Log Analytics module). */
export function getActiveCredentials(): GraphCredentials {
  return credentials;
}

/** Reports whether credentials are configured (without exposing the secret). */
export function getCredentialsStatus() {
  return {
    configured: !!(credentials.tenantId && credentials.clientId && credentials.clientSecret),
    tenantId: credentials.tenantId,
    clientId: credentials.clientId,
    hasSecret: !!credentials.clientSecret,
    workspaceConfigured: !!credentials.workspaceId,
    workspaceId: credentials.workspaceId || '',
  };
}

function getClient(): Client {
  const { tenantId, clientId, clientSecret } = credentials;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Credentials not configured. Click the gear (⚙️) and enter the Service Principal Tenant ID, Client ID and Secret.'
    );
  }

  const key = `${tenantId}|${clientId}|${clientSecret}`;
  if (cachedClient && cachedKey === key) return cachedClient;

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });

  cachedClient = Client.initWithMiddleware({ authProvider });
  cachedKey = key;
  return cachedClient;
}

/** Testa as credenciais atuais fazendo uma chamada minima ao Graph. */
export async function testConnection(): Promise<{ ok: boolean; org?: string }> {
  const client = getClient();
  const res = await client.api('/organization').select('displayName,id').get();
  const org = res.value?.[0]?.displayName;
  return { ok: true, org };
}

/** Escapa aspas simples para uso seguro em $filter OData. */
function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/** Resolve o usuario por UPN, email ou objectId. */
export async function getUser(identifier: string): Promise<UserProfile> {
  const client = getClient();
  const select =
    'id,displayName,userPrincipalName,mail,jobTitle,department,accountEnabled,createdDateTime';

  // Tenta acesso direto (funciona para UPN e objectId).
  try {
    const u = await client.api(`/users/${encodeURIComponent(identifier)}`).select(select).get();
    return mapUser(u);
  } catch {
    // Fallback: busca por mail ou proxyAddresses.
    const filter = `mail eq '${escapeOData(identifier)}' or userPrincipalName eq '${escapeOData(
      identifier
    )}'`;
    const res = await client.api('/users').filter(filter).select(select).top(1).get();
    if (!res.value || res.value.length === 0) {
      throw new Error(`User not found: ${identifier}`);
    }
    return mapUser(res.value[0]);
  }
}

function mapUser(u: any): UserProfile {
  return {
    id: u.id,
    displayName: u.displayName ?? null,
    userPrincipalName: u.userPrincipalName ?? null,
    mail: u.mail ?? null,
    jobTitle: u.jobTitle ?? null,
    department: u.department ?? null,
    accountEnabled: u.accountEnabled ?? null,
    createdDateTime: u.createdDateTime ?? null,
  };
}

function bytesToDataUri(buf: ArrayBuffer): string | null {
  if (!buf || buf.byteLength === 0) return null;
  const bytes = Buffer.from(buf);
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

// Cache do logo da empresa (raramente muda).
let cachedLogo: { tenant: string; value: string | null } | null = null;

/**
 * Busca o logo de branding do tenant (best-effort).
 * Requer a permissao OrganizationalBranding.Read.All; sem ela, retorna null.
 */
export async function getCompanyLogo(): Promise<string | null> {
  const client = getClient();
  const tenant = credentials.tenantId;
  if (cachedLogo && cachedLogo.tenant === tenant) return cachedLogo.value;

  // Tenta variantes de logo, da mais util para a menos.
  const endpoints = [
    `/organization/${tenant}/branding/localizations/0/bannerLogo`,
    `/organization/${tenant}/branding/bannerLogo`,
    `/organization/${tenant}/branding/localizations/0/squareLogo`,
    `/organization/${tenant}/branding/squareLogo`,
  ];

  let value: string | null = null;
  for (const ep of endpoints) {
    try {
      const buf: ArrayBuffer = await client.api(ep).responseType(ResponseType.ARRAYBUFFER).get();
      const uri = bytesToDataUri(buf as ArrayBuffer);
      if (uri) {
        value = uri;
        break;
      }
    } catch {
      // segue para o proximo endpoint
    }
  }

  cachedLogo = { tenant, value };
  return value;
}

// Friendly names for the most common license SKUs (fallback: the SKU part number).
const SKU_NAMES: Record<string, string> = {
  ENTERPRISEPACK: 'Office 365 E3',
  ENTERPRISEPREMIUM: 'Office 365 E5',
  STANDARDPACK: 'Office 365 E1',
  SPE_E3: 'Microsoft 365 E3',
  SPE_E5: 'Microsoft 365 E5',
  SPE_F1: 'Microsoft 365 F3',
  SPB: 'Microsoft 365 Business Premium',
  O365_BUSINESS_PREMIUM: 'Microsoft 365 Business Standard',
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
  O365_BUSINESS: 'Microsoft 365 Apps for Business',
  OFFICESUBSCRIPTION: 'Microsoft 365 Apps for Enterprise',
  EMS: 'Enterprise Mobility + Security E3',
  EMSPREMIUM: 'Enterprise Mobility + Security E5',
  AAD_PREMIUM: 'Entra ID P1',
  AAD_PREMIUM_P2: 'Entra ID P2',
  EXCHANGESTANDARD: 'Exchange Online Plan 1',
  EXCHANGEENTERPRISE: 'Exchange Online Plan 2',
  POWER_BI_STANDARD: 'Power BI (free)',
  POWER_BI_PRO: 'Power BI Pro',
  FLOW_FREE: 'Power Automate (free)',
  POWERAPPS_VIRAL: 'Power Apps (trial)',
  PROJECTPREMIUM: 'Project Plan 5',
  PROJECTPROFESSIONAL: 'Project Plan 3',
  VISIOCLIENT: 'Visio Plan 2',
  MCOEV: 'Teams Phone',
  MCOMEETADV: 'Microsoft 365 Audio Conferencing',
  TEAMS_EXPLORATORY: 'Teams Exploratory',
  STREAM: 'Microsoft Stream',
  RIGHTSMANAGEMENT: 'Azure Information Protection P1',
  WIN10_PRO_ENT_SUB: 'Windows 10/11 Enterprise E3',
  DEVELOPERPACK_E5: 'Microsoft 365 E5 Developer',
};

/** Reads the licenses assigned to the user. */
export async function getUserLicenses(userId: string): Promise<UserLicense[]> {
  const client = getClient();
  try {
    const res = await client.api(`/users/${encodeURIComponent(userId)}/licenseDetails`).get();
    return (res.value || []).map((l: any) => {
      const sku: string = l.skuPartNumber || '';
      const services = (l.servicePlans || [])
        .filter((p: any) => p.provisioningStatus === 'Success')
        .map((p: any) => p.servicePlanName);
      return {
        skuId: l.skuId,
        skuPartNumber: sku,
        displayName: SKU_NAMES[sku] || sku || 'Unknown SKU',
        enabledServices: services,
      };
    });
  } catch (err: any) {
    console.warn('Failed to read licenseDetails:', err?.message || err);
    return [];
  }
}

/** Reads the devices owned/registered by the user (Entra directory devices). */
export async function getUserDevices(userId: string): Promise<UserDevice[]> {
  const client = getClient();
  const select =
    'id,displayName,operatingSystem,operatingSystemVersion,isCompliant,isManaged,trustType,approximateLastSignInDateTime,deviceId,accountEnabled';
  const map = new Map<string, UserDevice>();

  async function pull(rel: 'ownedDevices' | 'registeredDevices', tag: 'owned' | 'registered') {
    try {
      const res = await client
        .api(`/users/${encodeURIComponent(userId)}/${rel}/microsoft.graph.device`)
        .select(select)
        .top(100)
        .get();
      for (const d of res.value || []) {
        const existing = map.get(d.id);
        if (existing) {
          existing.relationship = 'both';
          continue;
        }
        map.set(d.id, {
          id: d.id,
          displayName: d.displayName ?? null,
          operatingSystem: d.operatingSystem ?? null,
          operatingSystemVersion: d.operatingSystemVersion ?? null,
          isCompliant: d.isCompliant ?? null,
          isManaged: d.isManaged ?? null,
          trustType: d.trustType ?? null,
          accountEnabled: d.accountEnabled ?? null,
          approximateLastSignInDateTime: d.approximateLastSignInDateTime ?? null,
          deviceId: d.deviceId ?? null,
          relationship: tag,
        });
      }
    } catch (err: any) {
      console.warn(`Failed to read ${rel}:`, err?.message || err);
    }
  }

  await pull('ownedDevices', 'owned');
  await pull('registeredDevices', 'registered');
  return [...map.values()];
}

/** Busca a foto do usuario e retorna como data URI (ou null se nao houver). */
export async function getUserPhoto(userId: string): Promise<string | null> {
  const client = getClient();
  try {
    const buf: ArrayBuffer = await client
      .api(`/users/${encodeURIComponent(userId)}/photo/$value`)
      .responseType(ResponseType.ARRAYBUFFER)
      .get();
    return bytesToDataUri(buf as ArrayBuffer);
  } catch {
    // 404 = usuario sem foto; outros erros tambem caem aqui silenciosamente.
    return null;
  }
}

/** Busca o historico de sign-ins do usuario (com paginacao). */
export async function getSignIns(userId: string): Promise<SignInRecord[]> {
  const client = getClient();
  const records: SignInRecord[] = [];

  const filter = `userId eq '${escapeOData(userId)}'`;
  let response: PageCollection = await client
    .api('/auditLogs/signIns')
    .filter(filter)
    .top(Math.min(MAX_SIGNINS, 500))
    .get();

  while (response && response.value) {
    for (const s of response.value) {
      records.push(mapSignIn(s));
      if (records.length >= MAX_SIGNINS) return records;
    }
    if (response['@odata.nextLink']) {
      response = await client.api(response['@odata.nextLink']).get();
    } else {
      break;
    }
  }
  return records;
}

function mapSignIn(s: any): SignInRecord {
  return {
    id: s.id,
    createdDateTime: s.createdDateTime,
    appDisplayName: s.appDisplayName ?? null,
    appId: s.appId ?? null,
    ipAddress: s.ipAddress ?? null,
    clientAppUsed: s.clientAppUsed ?? null,
    resourceDisplayName: s.resourceDisplayName ?? null,
    isInteractive: !!s.isInteractive,
    riskLevelDuringSignIn: s.riskLevelDuringSignIn ?? null,
    riskState: s.riskState ?? null,
    conditionalAccessStatus: s.conditionalAccessStatus ?? null,
    location: s.location
      ? {
          city: s.location.city ?? undefined,
          state: s.location.state ?? undefined,
          countryOrRegion: s.location.countryOrRegion ?? undefined,
          geoCoordinates: s.location.geoCoordinates
            ? {
                latitude: s.location.geoCoordinates.latitude,
                longitude: s.location.geoCoordinates.longitude,
              }
            : undefined,
        }
      : null,
    status: {
      errorCode: s.status?.errorCode ?? 0,
      failureReason: s.status?.failureReason ?? null,
      additionalDetails: s.status?.additionalDetails ?? null,
    },
    deviceDetail: s.deviceDetail
      ? {
          operatingSystem: s.deviceDetail.operatingSystem,
          browser: s.deviceDetail.browser,
          deviceId: s.deviceDetail.deviceId,
          displayName: s.deviceDetail.displayName,
        }
      : null,
  };
}

/** Busca as roles de diretorio atribuidas ao usuario e identifica as privilegiadas. */
export async function getPrivilegedRoles(userId: string): Promise<PrivilegedRole[]> {
  const client = getClient();
  const roles: PrivilegedRole[] = [];

  try {
    const filter = `principalId eq '${escapeOData(userId)}'`;
    const res = await client
      .api('/roleManagement/directory/roleAssignments')
      .filter(filter)
      .expand('roleDefinition')
      .get();

    for (const a of res.value || []) {
      const def = a.roleDefinition || {};
      roles.push({
        roleDefinitionId: def.id ?? a.roleDefinitionId,
        displayName: def.displayName ?? 'Unknown',
        description: def.description ?? null,
        isBuiltIn: def.isBuiltIn ?? true,
        directoryScopeId: a.directoryScopeId ?? null,
        // isPrivileged e exposto pela unifiedRoleDefinition; caso ausente,
        // assume-se privilegiada por se tratar de role de diretorio atribuida.
        isPrivileged: def.isPrivileged ?? true,
      });
    }
  } catch (err: any) {
    // Missing RoleManagement.Read.Directory permission or tenant without unified RBAC.
    console.warn('Failed to read roleAssignments:', err?.message || err);
  }

  return roles;
}

/** Fetches a user's sign-ins within a time window, capped, for sampling. */
async function getSignInsWindow(userId: string, days: number, cap: number): Promise<SignInRecord[]> {
  const client = getClient();
  const records: SignInRecord[] = [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  // createdDateTime is Edm.DateTimeOffset -> literal without quotes.
  const filter = `userId eq '${escapeOData(userId)}' and createdDateTime ge ${cutoff}`;

  let response: PageCollection = await client
    .api('/auditLogs/signIns')
    .filter(filter)
    .top(Math.min(cap, 500))
    .get();

  while (response && response.value) {
    for (const s of response.value) {
      records.push(mapSignIn(s));
      if (records.length >= cap) return records;
    }
    if (response['@odata.nextLink']) {
      response = await client.api(response['@odata.nextLink']).get();
    } else {
      break;
    }
  }
  return records;
}

export interface TenantBaseline {
  sampleSize: number;
  days: number;
  avg: {
    totalSignIns: number;
    successfulSignIns: number;
    failedSignIns: number;
    uniqueApps: number;
    uniqueIps: number;
    uniqueCountries: number;
    licenses: number;
  };
  pctPrivileged: number;
}

/**
 * Estimates a tenant baseline by sampling enabled users and averaging their
 * metrics over the given window. Sampling keeps it bounded (per-user values are
 * capped), so the result is an estimate, not an exact tenant-wide figure.
 */
export async function getTenantBaseline(days: number, sample: number): Promise<TenantBaseline> {
  const client = getClient();
  const res = await client
    .api('/users')
    .filter('accountEnabled eq true')
    .select('id,userPrincipalName')
    .top(Math.min(sample, 999))
    .get();

  const users = (res.value || []).slice(0, sample);
  const acc = {
    totalSignIns: 0,
    successfulSignIns: 0,
    failedSignIns: 0,
    uniqueApps: 0,
    uniqueIps: 0,
    uniqueCountries: 0,
    licenses: 0,
  };
  let privCount = 0;
  let counted = 0;

  for (const u of users) {
    try {
      const [signIns, roles, lic] = await Promise.all([
        getSignInsWindow(u.id, days, 500),
        getPrivilegedRoles(u.id),
        getUserLicenses(u.id),
      ]);
      const apps = new Set(signIns.map((s) => s.appDisplayName).filter(Boolean));
      const ips = new Set(signIns.map((s) => s.ipAddress).filter(Boolean));
      const countries = new Set(signIns.map((s) => s.location?.countryOrRegion).filter(Boolean));
      acc.totalSignIns += signIns.length;
      acc.successfulSignIns += signIns.filter((s) => s.status.errorCode === 0).length;
      acc.failedSignIns += signIns.filter((s) => s.status.errorCode !== 0).length;
      acc.uniqueApps += apps.size;
      acc.uniqueIps += ips.size;
      acc.uniqueCountries += countries.size;
      acc.licenses += lic.length;
      if (roles.some((r) => r.isPrivileged)) privCount++;
      counted++;
    } catch {
      // skip users we cannot read
    }
  }

  const n = counted || 1;
  return {
    sampleSize: counted,
    days,
    avg: {
      totalSignIns: acc.totalSignIns / n,
      successfulSignIns: acc.successfulSignIns / n,
      failedSignIns: acc.failedSignIns / n,
      uniqueApps: acc.uniqueApps / n,
      uniqueIps: acc.uniqueIps / n,
      uniqueCountries: acc.uniqueCountries / n,
      licenses: acc.licenses / n,
    },
    pctPrivileged: (privCount / n) * 100,
  };
}

export interface AnalyzeOptions {
  source?: 'graph' | 'loganalytics';
  days?: number;
}

/** Orchestrates the full collection and builds the summary. */
export async function analyzeUser(
  identifier: string,
  options: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const source = options.source === 'loganalytics' ? 'loganalytics' : 'graph';
  const days = options.days && options.days > 0 ? options.days : source === 'loganalytics' ? 90 : 30;

  const user = await getUser(identifier);

  // Sign-ins come either from Graph (<=30 days) or from Log Analytics (90+ days).
  const signInsPromise =
    source === 'loganalytics'
      ? getSignInsFromLogAnalytics(user.id, user.userPrincipalName, days)
      : getSignIns(user.id);

  const [signIns, roles, photo, licenses, devices] = await Promise.all([
    signInsPromise,
    getPrivilegedRoles(user.id),
    getUserPhoto(user.id),
    getUserLicenses(user.id),
    getUserDevices(user.id),
  ]);
  user.photoDataUri = photo;

  const successful = signIns.filter((s) => s.status.errorCode === 0);
  const failed = signIns.filter((s) => s.status.errorCode !== 0);
  const apps = new Set(signIns.map((s) => s.appDisplayName).filter(Boolean));
  const ips = new Set(signIns.map((s) => s.ipAddress).filter(Boolean));
  const countries = new Set(
    signIns.map((s) => s.location?.countryOrRegion).filter(Boolean) as string[]
  );

  const dates = signIns.map((s) => s.createdDateTime).filter(Boolean).sort();

  return {
    user,
    generatedAt: new Date().toISOString(),
    source,
    days,
    signIns,
    roles,
    licenses,
    devices,
    summary: {
      totalSignIns: signIns.length,
      successfulSignIns: successful.length,
      failedSignIns: failed.length,
      uniqueApps: apps.size,
      uniqueIps: ips.size,
      uniqueCountries: countries.size,
      hasPrivilegedAccess: roles.some((r) => r.isPrivileged),
      firstSeen: dates.length ? dates[0] : null,
      lastSeen: dates.length ? dates[dates.length - 1] : null,
    },
  };
}
