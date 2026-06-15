import { ClientSecretCredential } from '@azure/identity';
import { LogsQueryClient, LogsQueryResultStatus } from '@azure/monitor-query';
import { getActiveCredentials } from './graph';
import { SignInRecord } from './types';

/**
 * Queries Azure Monitor / Log Analytics for SigninLogs, allowing historical
 * windows beyond the 30-day Microsoft Graph retention (e.g. 90+ days).
 *
 * Requirements:
 *   - Entra → Diagnostic settings: export "SigninLogs" to a Log Analytics workspace.
 *   - The Service Principal must have the "Log Analytics Reader" role on the workspace.
 *   - Configure the Workspace ID (GUID) via the gear panel.
 */
export async function getSignInsFromLogAnalytics(
  userId: string,
  upn: string | null,
  days: number
): Promise<SignInRecord[]> {
  const creds = getActiveCredentials();
  if (!creds.workspaceId) {
    throw new Error(
      'Log Analytics Workspace ID is not configured. Open the gear (⚙️) and set the Workspace ID to use this data source.'
    );
  }

  const credential = new ClientSecretCredential(creds.tenantId, creds.clientId, creds.clientSecret);
  const client = new LogsQueryClient(credential);

  // Build a safe user predicate (KQL string literals).
  const upnSafe = (upn || '').replace(/"/g, '');
  const idSafe = userId.replace(/"/g, '');
  const userPredicate = upnSafe
    ? `UserPrincipalName =~ "${upnSafe}" or UserId == "${idSafe}"`
    : `UserId == "${idSafe}"`;

  const query = `
    SigninLogs
    | where ${userPredicate}
    | project TimeGenerated, Id, AppDisplayName, AppId, IPAddress, ClientAppUsed,
              ResourceDisplayName, IsInteractive, RiskLevelDuringSignIn, RiskState,
              ConditionalAccessStatus, LocationDetails, Status, DeviceDetail
    | order by TimeGenerated desc
    | take 5000
  `;

  const result = await client.queryWorkspace(creds.workspaceId, query, {
    duration: `P${Math.max(1, Math.floor(days))}D`,
  });

  if (result.status !== LogsQueryResultStatus.Success) {
    const detail = (result as any).partialError?.message || 'unknown error';
    throw new Error(`Log Analytics query failed: ${detail}`);
  }

  const table = result.tables[0];
  if (!table) return [];

  const idx: Record<string, number> = {};
  table.columnDescriptors.forEach((c, i) => (idx[c.name as string] = i));

  return table.rows.map((row) => mapRow(row, idx));
}

function parseDynamic(value: any): any {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function mapRow(row: any[], idx: Record<string, number>): SignInRecord {
  const get = (name: string) => (idx[name] != null ? row[idx[name]] : undefined);

  const loc = parseDynamic(get('LocationDetails')) || {};
  const status = parseDynamic(get('Status')) || {};
  const device = parseDynamic(get('DeviceDetail')) || {};
  const time = get('TimeGenerated');
  const createdDateTime = time instanceof Date ? time.toISOString() : String(time ?? '');

  return {
    id: String(get('Id') ?? createdDateTime),
    createdDateTime,
    appDisplayName: get('AppDisplayName') ?? null,
    appId: get('AppId') ?? null,
    ipAddress: get('IPAddress') ?? null,
    clientAppUsed: get('ClientAppUsed') ?? null,
    resourceDisplayName: get('ResourceDisplayName') ?? null,
    isInteractive: !!get('IsInteractive'),
    riskLevelDuringSignIn: get('RiskLevelDuringSignIn') ?? null,
    riskState: get('RiskState') ?? null,
    conditionalAccessStatus: get('ConditionalAccessStatus') ?? null,
    location: loc
      ? {
          city: loc.city ?? undefined,
          state: loc.state ?? undefined,
          countryOrRegion: loc.countryOrRegion ?? undefined,
          geoCoordinates: loc.geoCoordinates
            ? {
                latitude: loc.geoCoordinates.latitude,
                longitude: loc.geoCoordinates.longitude,
              }
            : undefined,
        }
      : null,
    status: {
      errorCode: Number(status.errorCode ?? 0),
      failureReason: status.failureReason ?? null,
      additionalDetails: status.additionalDetails ?? null,
    },
    deviceDetail: device
      ? {
          operatingSystem: device.operatingSystem,
          browser: device.browser,
          deviceId: device.deviceId,
          displayName: device.displayName,
        }
      : null,
  };
}
