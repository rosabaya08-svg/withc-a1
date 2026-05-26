export type Branch = {
  id: string;
  bizNum: string;
  businessName: string;
  storeName: string;
  ownerUid: string;
  status: string;
  a4Status: "active" | "suspended";
  a4SuspendedReason: string;
  a4SuspendedAt: string;
  a4SuspendedBy: string;
  resumedAt: string;
  authorizedAdmins: string[];
  raw: Record<string, unknown>;
};

export type StorageAdFile = {
  id: string;
  name: string;
  fullPath: string;
  bucket: string;
  contentType: string;
  size: number;
  updated: string;
  url: string;
  customMetadata?: Record<string, string>;
};

export type AppRelease = {
  id: string;
  appId: string;
  versionName: string;
  versionCode: number;
  apkUrl: string;
  storagePath: string;
  fileName: string;
  size: number;
  forceUpdate: boolean;
  releaseNote: string;
  updatedAt: string;
  uploadedBy: string;
  raw: Record<string, unknown>;
};

export type Device = {
  id: string;
  bizNum: string;
  ownerUid: string;
  name: string;
  roomName: string;
  status: string;
  appVersion: string;
  platform: string;
  lastSeen: string;
  raw: Record<string, unknown>;
};

export type DevicePresence = {
  deviceId: string;
  bizNum: string;
  connected: boolean;
  presenceStatus: string;
  lastHeartbeatAtMs: number;
  lastDisconnectedAtMs: number;
  sessionId: string;
  source: string;
  raw: Record<string, unknown>;
};

export type AdAsset = {
  id: string;
  title: string;
  advertiser: string;
  fileName: string;
  status: string;
  durationSec: number;
  targetBizNums: string[];
  url: string;
  placement: string;
  clickTarget: string;
};

export type AdPlayEvent = {
  id: string;
  adId: string;
  campaignId: string;
  bizNum: string;
  deviceId: string;
  storeName: string;
  completed: boolean;
  failed: boolean;
  startedAt: string;
  raw: Record<string, unknown>;
};

export type AdDailyRollup = {
  id: string;
  dateKey: string;
  adId: string;
  assetId: string;
  bizNum: string;
  deviceId: string;
  storeName: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  raw: Record<string, unknown>;
};

export type AuditLog = {
  id: string;
  action: string;
  actorUid: string;
  target: string;
  detail: string;
  createdAt: string;
};

export type AdminProfile = {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  managedShops: string[];
};
