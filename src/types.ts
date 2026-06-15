// Tipos compartilhados entre backend e frontend

export interface GeoCoordinates {
  latitude?: number;
  longitude?: number;
}

export interface SignInLocation {
  city?: string;
  state?: string;
  countryOrRegion?: string;
  geoCoordinates?: GeoCoordinates;
}

export interface SignInRecord {
  id: string;
  createdDateTime: string;
  appDisplayName: string | null;
  appId: string | null;
  ipAddress: string | null;
  clientAppUsed: string | null;
  resourceDisplayName: string | null;
  isInteractive: boolean;
  riskLevelDuringSignIn: string | null;
  riskState: string | null;
  conditionalAccessStatus: string | null;
  location: SignInLocation | null;
  status: {
    errorCode: number;
    failureReason: string | null;
    additionalDetails: string | null;
  };
  deviceDetail: {
    operatingSystem?: string;
    browser?: string;
    deviceId?: string;
    displayName?: string;
  } | null;
}

export interface PrivilegedRole {
  roleDefinitionId: string;
  displayName: string;
  description: string | null;
  isBuiltIn: boolean;
  directoryScopeId: string | null;
  isPrivileged: boolean;
}

export interface UserProfile {
  id: string;
  displayName: string | null;
  userPrincipalName: string | null;
  mail: string | null;
  jobTitle: string | null;
  department: string | null;
  accountEnabled: boolean | null;
  createdDateTime: string | null;
  photoDataUri?: string | null;
}

export interface UserLicense {
  skuId: string;
  skuPartNumber: string;
  displayName: string;
  enabledServices: string[];
}

export interface UserDevice {
  id: string;
  displayName: string | null;
  operatingSystem: string | null;
  operatingSystemVersion: string | null;
  isCompliant: boolean | null;
  isManaged: boolean | null;
  trustType: string | null;
  accountEnabled: boolean | null;
  approximateLastSignInDateTime: string | null;
  deviceId: string | null;
  relationship: 'owned' | 'registered' | 'both';
}

export interface AnalysisResult {
  user: UserProfile;
  generatedAt: string;
  source: 'graph' | 'loganalytics';
  days: number;
  signIns: SignInRecord[];
  licenses: UserLicense[];
  devices: UserDevice[];
  roles: PrivilegedRole[];
  summary: {
    totalSignIns: number;
    successfulSignIns: number;
    failedSignIns: number;
    uniqueApps: number;
    uniqueIps: number;
    uniqueCountries: number;
    hasPrivilegedAccess: boolean;
    firstSeen: string | null;
    lastSeen: string | null;
  };
}
