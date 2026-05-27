"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Building2,
  ChevronRight,
  Database,
  Eye,
  FileVideo,
  Gauge,
  HardDrive,
  Laptop,
  Lock,
  LogIn,
  LogOut,
  Power,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Trash2,
  Unlock,
  Upload,
  Video
} from "lucide-react";
import { User, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentReference
} from "firebase/firestore";
import { onValue, push, ref as rtdbRef, set } from "firebase/database";
import { deleteObject, getDownloadURL, getMetadata, listAll, ref as storageRef, updateMetadata, uploadBytesResumable, type StorageReference } from "firebase/storage";
import { getFirebaseServices, hasFirebaseConfig } from "@/lib/firebase";
import type { AdAsset, AdDailyRollup, AdPlayEvent, AdminProfile, AppRelease, AuditLog, Branch, Device, DevicePresence, StorageAdFile } from "@/types";

const MASTER_EMAIL_HASH = "a4f828fbd0b0d2fb38524e2c80f88357b40ea9e06bdb0604f23278af8049ee1d";

type SectionKey = "overview" | "stores" | "devices" | "control" | "broadcast" | "storage" | "releases" | "database" | "audit";
type AdDeliveryScope = "store" | "global" | "region" | "category" | "segment";
type AdTargetMode = AdDeliveryScope;
type AdPlacement = "normal" | "portrait_fullscreen";
type AdClickTarget = "hotdeal" | "luxury";
type AdPlaybackMode = "rolling" | "daily_limit";
type AccountPurgePreview = {
  uid: string;
  bizNum: string;
  storageFiles: StorageAdFile[];
  totalBytes: number;
  deviceCount: number;
  playlistRefCount: number;
  scannedAt: string;
};
type AdPolicy = {
  placement: AdPlacement;
  clickTarget: AdClickTarget;
  playbackMode: AdPlaybackMode;
  dailyLimit: number;
  scheduleStartDate: string;
  scheduleEndDate: string;
  scheduleStartTime: string;
  scheduleEndTime: string;
};
type A3AdVideoEntry = {
  url: string;
  storagePath: string;
  fileName: string;
  name: string;
  contentType: string;
  size: number;
  assetId: string;
  source: string;
  placement: AdPlacement;
  displayMode: "normal" | "fullscreen";
  clickTarget: AdClickTarget;
  landingUrl: string;
  analysisMode: "daily_until_yesterday";
  playbackMode: AdPlaybackMode;
  dailyLimit: number;
  scheduleStartDate: string;
  scheduleEndDate: string;
  scheduleStartTime: string;
  scheduleEndTime: string;
};

function text(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAdPlacement(value: unknown): AdPlacement {
  return text(value) === "portrait_fullscreen" ? "portrait_fullscreen" : "normal";
}

function normalizeAdClickTarget(value: unknown): AdClickTarget {
  return text(value) === "luxury" ? "luxury" : "hotdeal";
}

function normalizeAdPlaybackMode(value: unknown): AdPlaybackMode {
  return text(value) === "daily_limit" ? "daily_limit" : "rolling";
}

function normalizeDailyLimit(value: unknown) {
  const parsed = Math.floor(numberValue(value));
  return parsed > 0 ? parsed : 0;
}

function adLandingUrl(target: AdClickTarget) {
  return target === "luxury" ? "https://signage-ai-a5.co.kr/luxuly" : "https://signage-ai-a5.co.kr";
}

function adPlacementLabel(placement: AdPlacement) {
  return placement === "portrait_fullscreen" ? "세로 전면" : "기본 광고";
}

function adClickTargetLabel(target: AdClickTarget) {
  return target === "luxury" ? "명품관" : "핫딜";
}

function adPlaybackModeLabel(mode: AdPlaybackMode) {
  return mode === "daily_limit" ? "하루 횟수 제한" : "단순 롤링";
}

function adDeliveryScopeLabel(scope: AdDeliveryScope) {
  if (scope === "global") return "전체";
  if (scope === "region") return "권역별";
  if (scope === "category") return "카테고리별";
  if (scope === "segment") return "권역+카테고리";
  return "선택 매장";
}

function adPolicyFromSources(...sources: Array<Record<string, unknown> | undefined>): AdPolicy {
  const data = Object.assign({}, ...sources.filter(Boolean));
  return {
    placement: normalizeAdPlacement(data.placement || data.adPlacement),
    clickTarget: normalizeAdClickTarget(data.clickTarget || data.click_target || data.target),
    playbackMode: normalizeAdPlaybackMode(data.playbackMode || data.playback_mode),
    dailyLimit: normalizeDailyLimit(data.dailyLimit || data.daily_limit),
    scheduleStartDate: text(data.scheduleStartDate || data.schedule_start_date),
    scheduleEndDate: text(data.scheduleEndDate || data.schedule_end_date),
    scheduleStartTime: text(data.scheduleStartTime || data.schedule_start_time),
    scheduleEndTime: text(data.scheduleEndTime || data.schedule_end_time)
  };
}

function defaultAdPolicy(): AdPolicy {
  return {
    placement: "normal",
    clickTarget: "hotdeal",
    playbackMode: "rolling",
    dailyLimit: 0,
    scheduleStartDate: "",
    scheduleEndDate: "",
    scheduleStartTime: "",
    scheduleEndTime: ""
  };
}

function adPolicyStorageMetadata(policy: AdPolicy) {
  return {
    placement: policy.placement,
    displayMode: policy.placement === "portrait_fullscreen" ? "fullscreen" : "normal",
    clickTarget: policy.clickTarget,
    landingUrl: adLandingUrl(policy.clickTarget),
    analysisMode: "daily_until_yesterday",
    playbackMode: policy.playbackMode,
    dailyLimit: String(policy.dailyLimit),
    scheduleStartDate: policy.scheduleStartDate,
    scheduleEndDate: policy.scheduleEndDate,
    scheduleStartTime: policy.scheduleStartTime,
    scheduleEndTime: policy.scheduleEndTime
  };
}

function adPolicyFirestoreFields(policy: AdPolicy) {
  return {
    placement: policy.placement,
    displayMode: policy.placement === "portrait_fullscreen" ? "fullscreen" : "normal",
    clickTarget: policy.clickTarget,
    landingUrl: adLandingUrl(policy.clickTarget),
    analysisMode: "daily_until_yesterday",
    playbackMode: policy.playbackMode,
    dailyLimit: policy.dailyLimit,
    scheduleStartDate: policy.scheduleStartDate,
    scheduleEndDate: policy.scheduleEndDate,
    scheduleStartTime: policy.scheduleStartTime,
    scheduleEndTime: policy.scheduleEndTime
  };
}

function adScheduleSummary(policy: AdPolicy) {
  const count = policy.playbackMode === "daily_limit" && policy.dailyLimit > 0 ? `하루 ${policy.dailyLimit}회` : "단순 롤링";
  const dateRange = policy.scheduleStartDate || policy.scheduleEndDate ? `${policy.scheduleStartDate || "시작"}~${policy.scheduleEndDate || "종료"}` : "상시";
  const timeRange = policy.scheduleStartTime || policy.scheduleEndTime ? `${policy.scheduleStartTime || "00:00"}~${policy.scheduleEndTime || "23:59"}` : "전일";
  return `${count} / ${dateRange} / ${timeRange}`;
}

function getDateKey(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function getYesterdayDateKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return getDateKey(date);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isMasterEmail(email: string | null) {
  if (!email || !crypto.subtle) return false;
  return (await sha256Hex(email.trim().toLowerCase())) === MASTER_EMAIL_HASH;
}

function dateText(value: unknown) {
  if (!value) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toLocaleString("ko-KR");
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toLocaleString("ko-KR");
  }
  return "-";
}

function bytesText(value: number) {
  if (!value) return "-";
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function normalizeSido(value: string) {
  if (!value) return "";
  if (value === "서울") return "서울특별시";
  if (value === "경기") return "경기도";
  if (value === "인천") return "인천광역시";
  if (value === "부산") return "부산광역시";
  if (value === "대구") return "대구광역시";
  if (value === "대전") return "대전광역시";
  if (value === "광주") return "광주광역시";
  if (value === "울산") return "울산광역시";
  if (value === "세종") return "세종특별자치시";
  return value;
}

function deriveRegionFromAddress(address: string) {
  const tokens = address.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const sido = normalizeSido(tokens[0] || "");
  if (!sido) return { regionSido: "", regionUnit: "", regionKey: "" };

  const isMetro = sido.includes("특별시") || sido.includes("광역시");
  const unit =
    sido.includes("서울")
      ? tokens.find((token) => token.endsWith("구")) || tokens[1] || ""
      : isMetro
        ? tokens.find((token, index) => index > 0 && (token.endsWith("구") || token.endsWith("군"))) || tokens[1] || ""
        : tokens.find((token, index) => index > 0 && (token.endsWith("시") || token.endsWith("군"))) || tokens[1] || "";

  return {
    regionSido: sido,
    regionUnit: unit,
    regionKey: [sido, unit].filter(Boolean).join(" ")
  };
}

function assetIdFromStoragePath(storagePath: string) {
  return storagePath.replace(/[/.]/g, "_");
}

function isStorageObjectNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && String((error as { code?: unknown }).code) === "storage/object-not-found";
}

function adUrlFromEntry(entry: unknown) {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object") {
    const row = entry as Record<string, unknown>;
    return text(row.url || row.downloadUrl || row.storageUrl);
  }
  return "";
}

function storagePathFromFirebaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    const objectIndex = parsed.pathname.split("/").findIndex((part) => part === "o");
    const parts = parsed.pathname.split("/");
    if (objectIndex >= 0 && parts[objectIndex + 1]) return decodeURIComponent(parts[objectIndex + 1]);
  } catch {
    return "";
  }
  return "";
}

function uploadEntryMatchesFile(entry: unknown, storagePaths: Set<string>, urls: Set<string>) {
  const url = adUrlFromEntry(entry);
  const entryStoragePath =
    typeof entry === "object" && entry !== null
      ? text((entry as Record<string, unknown>).storagePath || (entry as Record<string, unknown>).storage_path || (entry as Record<string, unknown>).fullPath)
      : "";
  return Boolean(
    (url && urls.has(url)) ||
      (url && storagePaths.has(storagePathFromFirebaseUrl(url))) ||
      (entryStoragePath && storagePaths.has(entryStoragePath))
  );
}

function filterUploadedMediaList(list: unknown, files: StorageAdFile[]) {
  if (!Array.isArray(list)) return [];
  const storagePaths = new Set(files.map((file) => file.fullPath));
  const urls = new Set(files.map((file) => file.url).filter(Boolean));
  return list.filter((entry) => !uploadEntryMatchesFile(entry, storagePaths, urls));
}

function countUploadedMediaRefs(list: unknown, files: StorageAdFile[]) {
  if (!Array.isArray(list)) return 0;
  const storagePaths = new Set(files.map((file) => file.fullPath));
  const urls = new Set(files.map((file) => file.url).filter(Boolean));
  return list.filter((entry) => uploadEntryMatchesFile(entry, storagePaths, urls)).length;
}

async function listStorageFilesRecursive(root: StorageReference): Promise<StorageAdFile[]> {
  const result = await listAll(root);
  const files = await Promise.all(
    result.items.map(async (item) => {
      const [metadata, url] = await Promise.all([getMetadata(item), getDownloadURL(item).catch(() => "")]);
      return {
        id: item.fullPath,
        name: item.name,
        fullPath: item.fullPath,
        bucket: item.bucket,
        contentType: metadata.contentType || "-",
        size: metadata.size || 0,
        updated: metadata.updated ? new Date(metadata.updated).toLocaleString("ko-KR") : "-",
        url,
        customMetadata: metadata.customMetadata || {}
      };
    })
  );
  const nested = await Promise.all(result.prefixes.map((prefix) => listStorageFilesRecursive(prefix)));
  return [...files, ...nested.flat()];
}

function adEntryMatchesFile(entry: unknown, file: Pick<StorageAdFile, "url" | "fullPath">) {
  const assetId = assetIdFromStoragePath(file.fullPath);
  const entryUrl = adUrlFromEntry(entry);
  const entryStoragePathFromUrl = storagePathFromFirebaseUrl(entryUrl);

  if (typeof entry === "string") {
    return (Boolean(file.url) && entry === file.url) || entryStoragePathFromUrl === file.fullPath;
  }

  if (entry && typeof entry === "object") {
    const row = entry as Record<string, unknown>;
    return (
      entryUrl === file.url ||
      entryStoragePathFromUrl === file.fullPath ||
      text(row.storagePath || row.storage_path || row.fullPath) === file.fullPath ||
      text(row.assetId || row.asset_id || row.adId || row.id) === assetId
    );
  }
  return false;
}

function a3AdEntryFromFile(file: StorageAdFile, policy?: Partial<AdPolicy>): A3AdVideoEntry {
  const sourcePolicy = adPolicyFromSources(file.customMetadata);
  const resolvedPolicy = { ...sourcePolicy, ...policy };
  return {
    url: file.url,
    storagePath: file.fullPath,
    fileName: file.name,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    assetId: assetIdFromStoragePath(file.fullPath),
    source: "a1_storage",
    placement: resolvedPolicy.placement,
    displayMode: resolvedPolicy.placement === "portrait_fullscreen" ? "fullscreen" : "normal",
    clickTarget: resolvedPolicy.clickTarget,
    landingUrl: adLandingUrl(resolvedPolicy.clickTarget),
    analysisMode: "daily_until_yesterday",
    playbackMode: resolvedPolicy.playbackMode,
    dailyLimit: resolvedPolicy.dailyLimit,
    scheduleStartDate: resolvedPolicy.scheduleStartDate,
    scheduleEndDate: resolvedPolicy.scheduleEndDate,
    scheduleStartTime: resolvedPolicy.scheduleStartTime,
    scheduleEndTime: resolvedPolicy.scheduleEndTime
  };
}

function normalizeA3AdEntry(entry: unknown): A3AdVideoEntry | null {
  const url = adUrlFromEntry(entry);
  if (!url) return null;

  if (entry && typeof entry === "object") {
    const row = entry as Record<string, unknown>;
    const storagePath = text(row.storagePath || row.storage_path || row.fullPath) || storagePathFromFirebaseUrl(url);
    const fileName = text(row.fileName || row.file_name || row.name) || storagePath.split("/").pop() || url.split("/").pop() || "ad_video.mp4";
    const rowDisplayMode = text(row.displayMode || row.display_mode);
    const placement = normalizeAdPlacement(
      row.placement || row.adPlacement || (rowDisplayMode === "fullscreen" ? "portrait_fullscreen" : "normal")
    );
    return {
      url,
      storagePath,
      fileName,
      name: fileName,
      contentType: text(row.contentType || row.content_type, "video/mp4"),
      size: numberValue(row.size),
      assetId: text(row.assetId || row.asset_id || row.adId || row.id) || assetIdFromStoragePath(storagePath || fileName),
      source: text(row.source, "a1_storage"),
      placement,
      displayMode: placement === "portrait_fullscreen" || rowDisplayMode === "fullscreen" ? "fullscreen" : "normal",
      clickTarget: normalizeAdClickTarget(row.clickTarget || row.click_target || row.target),
      landingUrl: text(row.landingUrl || row.landing_url) || adLandingUrl(normalizeAdClickTarget(row.clickTarget || row.click_target || row.target)),
      analysisMode: "daily_until_yesterday",
      playbackMode: normalizeAdPlaybackMode(row.playbackMode || row.playback_mode),
      dailyLimit: normalizeDailyLimit(row.dailyLimit || row.daily_limit),
      scheduleStartDate: text(row.scheduleStartDate || row.schedule_start_date),
      scheduleEndDate: text(row.scheduleEndDate || row.schedule_end_date),
      scheduleStartTime: text(row.scheduleStartTime || row.schedule_start_time),
      scheduleEndTime: text(row.scheduleEndTime || row.schedule_end_time)
    };
  }

  const storagePath = storagePathFromFirebaseUrl(url);
  const fileName = storagePath.split("/").pop() || url.split("/").pop() || "ad_video.mp4";
  return {
    url,
    storagePath,
    fileName,
    name: fileName,
    contentType: "video/mp4",
    size: 0,
    assetId: assetIdFromStoragePath(storagePath || fileName),
    source: "a1_storage",
    placement: "normal",
    displayMode: "normal",
    clickTarget: "hotdeal",
    landingUrl: adLandingUrl("hotdeal"),
    analysisMode: "daily_until_yesterday",
    playbackMode: "rolling",
    dailyLimit: 0,
    scheduleStartDate: "",
    scheduleEndDate: "",
    scheduleStartTime: "",
    scheduleEndTime: ""
  };
}

function parseA3ApkInfo(file: StorageAdFile) {
  const metadata = file.customMetadata || {};
  const metadataVersionName = text(metadata.versionName || metadata.version_name);
  const metadataVersionCode = numberValue(metadata.versionCode || metadata.version_code);
  if (metadataVersionName && metadataVersionCode > 0) {
    return { versionName: metadataVersionName, versionCode: metadataVersionCode };
  }

  const match = file.name.match(/^a3_(.+)_(\d+)_\d+_/);
  if (match) {
    return { versionName: match[1], versionCode: Number(match[2]) };
  }

  return { versionName: "", versionCode: 0 };
}

function normalizeBranch(id: string, data: Record<string, unknown>): Branch {
  const a4Status = text(data.a4_status || data.a4Status, "active") === "suspended" ? "suspended" : "active";
  const accountStatus = text(data.account_status || data.accountStatus, "active") === "suspended" ? "suspended" : "active";
  const bizNum = text(data.bizNum || data.businessNumber || data.business_registration_number, id);
  const businessName = text(
    data.store_name ||
      data.businessName ||
      data.business_name ||
      data.companyName ||
      data.company_name ||
      data.storeName ||
      data.shopName ||
      data.name,
    id
  );
  const address = text(data.address || data.store_address || data.roadAddress || data.road_address);
  const derivedRegion = deriveRegionFromAddress(address);
  const regionSido = text(data.regionSido || data.region_sido, derivedRegion.regionSido);
  const regionUnit = text(data.regionUnit || data.region_unit, derivedRegion.regionUnit);

  return {
    id,
    bizNum,
    businessName,
    storeName: text(data.store_name || data.storeName || data.shopName || data.name || data.businessName || data.business_name, businessName),
    ownerUid: text(data.ownerUid || data.owner_uid),
    category: text(data.category || data.store_category || data.businessCategory || data.business_category, "미분류"),
    address,
    regionSido,
    regionUnit,
    regionKey: text(data.regionKey || data.region_key, [regionSido, regionUnit].filter(Boolean).join(" ")),
    status: text(data.status, "active"),
    accountStatus,
    accountSuspendedReason: text(data.account_suspended_reason || data.accountSuspendedReason),
    accountSuspendedAt: dateText(data.account_suspended_at || data.accountSuspendedAt),
    accountSuspendedBy: text(data.account_suspended_by || data.accountSuspendedBy),
    accountResumedAt: dateText(data.account_resumed_at || data.accountResumedAt),
    a4Status,
    a4SuspendedReason: text(data.a4_suspended_reason || data.a4SuspendedReason),
    a4SuspendedAt: dateText(data.a4_suspended_at || data.a4SuspendedAt),
    a4SuspendedBy: text(data.a4_suspended_by || data.a4SuspendedBy),
    resumedAt: dateText(data.a4_resumed_at || data.a4ResumedAt),
    authorizedAdmins: Array.isArray(data.authorized_admins) ? data.authorized_admins.map(String) : [],
    raw: data
  };
}

function normalizeDevice(id: string, data: Record<string, unknown>): Device {
  const lastSeen = data.lastHeartbeatAt || data.lastSeen || data.last_seen || data.updated_at || data.updatedAt || data.checkInTime;
  const bizNum = text(data.bizNum || data.businessNumber || data.owner_biz_num);
  const ownerUid = text(data.owner_uid || data.ownerUid);
  const name = text(data.device_name || data.name || data.roomName || data.room_id, id);

  return {
    id,
    bizNum,
    ownerUid,
    name,
    roomName: text(data.roomName || data.device_name || data.room_id, name),
    status: text(data.status || data.roomStatus, "-"),
    appVersion: text(data.appVersion || data.app_version || data.version, "-"),
    platform: text(data.platform || data.os || data.device_platform, "-"),
    lastSeen: dateText(lastSeen),
    raw: data
  };
}

function normalizeAppRelease(id: string, data: Record<string, unknown>): AppRelease {
  return {
    id,
    appId: text(data.appId || data.app_id, id),
    versionName: text(data.versionName || data.version_name, "-"),
    versionCode: numberValue(data.versionCode || data.version_code),
    apkUrl: text(data.apkUrl || data.apk_url || data.url),
    storagePath: text(data.storagePath || data.storage_path),
    fileName: text(data.fileName || data.file_name),
    size: numberValue(data.size),
    forceUpdate: data.forceUpdate === true || data.force_update === true,
    releaseNote: text(data.releaseNote || data.release_note),
    updatedAt: dateText(data.updatedAt || data.updated_at || data.createdAt),
    uploadedBy: text(data.uploadedBy || data.uploaded_by),
    raw: data
  };
}

function normalizePresence(id: string, value: unknown): DevicePresence {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    deviceId: text(data.deviceId, id),
    bizNum: text(data.bizNum),
    connected: data.connected === true,
    presenceStatus: text(data.presenceStatus || data.status, "unknown"),
    lastHeartbeatAtMs: numberValue(data.lastHeartbeatAtMs || data.lastHeartbeatAt),
    lastDisconnectedAtMs: numberValue(data.lastDisconnectedAtMs || data.lastDisconnectedAt),
    sessionId: text(data.sessionId),
    source: text(data.source, "a3"),
    raw: data
  };
}

function normalizeAdAsset(id: string, data: Record<string, unknown>): AdAsset {
  const targets = data.targetBizNums || data.target_biz_nums || data.bizNums || data.stores;

  return {
    id,
    title: text(data.title || data.name, id),
    advertiser: text(data.advertiser || data.client || data.brand, "-"),
    fileName: text(data.fileName || data.file_name || data.storagePath || data.url, "-"),
    status: text(data.status, "active"),
    durationSec: numberValue(data.durationSec || data.duration || data.duration_seconds),
    targetBizNums: Array.isArray(targets) ? targets.map(String) : [],
    url: text(data.url || data.downloadUrl || data.storageUrl),
    placement: text(data.placement || data.adPlacement, "normal"),
    clickTarget: text(data.clickTarget || data.click_target || data.target, "hotdeal"),
    playbackMode: text(data.playbackMode || data.playback_mode, "rolling"),
    dailyLimit: normalizeDailyLimit(data.dailyLimit || data.daily_limit),
    scheduleStartDate: text(data.scheduleStartDate || data.schedule_start_date),
    scheduleEndDate: text(data.scheduleEndDate || data.schedule_end_date),
    scheduleStartTime: text(data.scheduleStartTime || data.schedule_start_time),
    scheduleEndTime: text(data.scheduleEndTime || data.schedule_end_time)
  };
}

function normalizeAdDailyRollup(id: string, data: Record<string, unknown>): AdDailyRollup {
  return {
    id,
    dateKey: text(data.dateKey || data.date_key),
    adId: text(data.adId || data.ad_id || data.assetId || data.asset_id),
    assetId: text(data.assetId || data.asset_id || data.adId || data.ad_id),
    bizNum: text(data.bizNum || data.businessNumber || data.storeId || data.store_id),
    deviceId: text(data.deviceId || data.device_id),
    storeName: text(data.storeName || data.shopName),
    totalCount: numberValue(data.totalCount || data.total_count || data.playCount || data.play_count),
    completedCount: numberValue(data.completedCount || data.completed_count),
    failedCount: numberValue(data.failedCount || data.failed_count),
    raw: data
  };
}

function normalizeAdEvent(id: string, data: Record<string, unknown>): AdPlayEvent {
  return {
    id,
    adId: text(data.adId || data.ad_id || data.assetId || data.asset_id),
    campaignId: text(data.campaignId || data.campaign_id),
    bizNum: text(data.bizNum || data.businessNumber || data.storeId || data.store_id),
    deviceId: text(data.deviceId || data.device_id),
    storeName: text(data.storeName || data.shopName),
    completed: data.completed === true || data.status === "completed",
    failed: data.failed === true || data.status === "failed",
    startedAt: dateText(data.startedAt || data.started_at || data.playedAt || data.played_at || data.createdAt),
    raw: data
  };
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const ONLINE_WINDOW_MS = 90 * 1000;
const STALE_WINDOW_MS = 3 * 60 * 1000;

type PresenceView = {
  status: "online" | "stale" | "offline" | "unknown";
  label: string;
  tone: "green" | "amber" | "red";
  lastText: string;
};

function agoText(ageMs: number) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "-";
  if (ageMs < 60 * 1000) return `${Math.max(1, Math.floor(ageMs / 1000))}초 전`;
  if (ageMs < 60 * 60 * 1000) return `${Math.floor(ageMs / 60000)}분 전`;
  return `${Math.floor(ageMs / 3600000)}시간 전`;
}

function resolveDevicePresence(device: Device, presence: DevicePresence | undefined, nowMs: number): PresenceView {
  const mirroredHeartbeatMs = numberValue(device.raw.lastHeartbeatAtMs || device.raw.lastHeartbeatAt);
  const mirroredDisconnectedMs = numberValue(device.raw.lastDisconnectedAtMs || device.raw.lastDisconnectedAt);
  const mirroredStatus = text(device.raw.presence_status || device.raw.presenceStatus || device.raw.onlineStatus || device.raw.connectionStatus).toLowerCase();
  const heartbeatMs = presence?.lastHeartbeatAtMs || mirroredHeartbeatMs;
  const ageMs = heartbeatMs ? nowMs - heartbeatMs : Number.POSITIVE_INFINITY;
  const isConnected = presence?.connected === true || (!presence && mirroredStatus === "online");
  const isDisconnected = presence?.connected === false || (!presence && ["offline", "disconnected"].includes(mirroredStatus));

  if (isConnected && ageMs <= ONLINE_WINDOW_MS) {
    return { status: "online", label: "신호 수신", tone: "green", lastText: agoText(ageMs) };
  }

  if (isDisconnected) {
    const disconnectedMs = presence?.lastDisconnectedAtMs || mirroredDisconnectedMs || heartbeatMs;
    const disconnectedAgeMs = disconnectedMs ? nowMs - disconnectedMs : Number.POSITIVE_INFINITY;
    return { status: "offline", label: "꺼짐/미수신", tone: "red", lastText: agoText(disconnectedAgeMs) };
  }

  if (heartbeatMs && ageMs <= STALE_WINDOW_MS) {
    return { status: "stale", label: "신호 지연", tone: "amber", lastText: agoText(ageMs) };
  }

  if (heartbeatMs) {
    return { status: "offline", label: "꺼짐/미수신", tone: "red", lastText: agoText(ageMs) };
  }

  return { status: "unknown", label: "신호 없음", tone: "red", lastText: "-" };
}

export default function A1Page() {
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [presenceByDeviceId, setPresenceByDeviceId] = useState<Record<string, DevicePresence>>({});
  const [presencePermissionDenied, setPresencePermissionDenied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [adAssets, setAdAssets] = useState<AdAsset[]>([]);
  const [storageAdFiles, setStorageAdFiles] = useState<StorageAdFile[]>([]);
  const [apkFiles, setApkFiles] = useState<StorageAdFile[]>([]);
  const [appReleases, setAppReleases] = useState<AppRelease[]>([]);
  const [adEvents, setAdEvents] = useState<AdPlayEvent[]>([]);
  const [adDailyRollups, setAdDailyRollups] = useState<AdDailyRollup[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedBizNum, setSelectedBizNum] = useState("");
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("관리자 사용중단 처리");
  const [loadingAction, setLoadingAction] = useState(false);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [loadingApks, setLoadingApks] = useState(false);
  const [uploadingStorage, setUploadingStorage] = useState(false);
  const [uploadingApk, setUploadingApk] = useState(false);
  const [syncingAssets, setSyncingAssets] = useState(false);
  const [deletingStoragePath, setDeletingStoragePath] = useState("");
  const [deletingApkPath, setDeletingApkPath] = useState("");
  const [deployingApkPath, setDeployingApkPath] = useState("");
  const [selectedStorageAdPath, setSelectedStorageAdPath] = useState("");
  const [adTargetMode, setAdTargetMode] = useState<AdTargetMode>("global");
  const [selectedAdRegionKey, setSelectedAdRegionKey] = useState("");
  const [selectedAdCategory, setSelectedAdCategory] = useState("");
  const [adPlacement, setAdPlacement] = useState<AdPlacement>("normal");
  const [adClickTarget, setAdClickTarget] = useState<AdClickTarget>("hotdeal");
  const [adPlaybackMode, setAdPlaybackMode] = useState<AdPlaybackMode>("rolling");
  const [adDailyLimit, setAdDailyLimit] = useState("0");
  const [adScheduleStartDate, setAdScheduleStartDate] = useState("");
  const [adScheduleEndDate, setAdScheduleEndDate] = useState("");
  const [adScheduleStartTime, setAdScheduleStartTime] = useState("");
  const [adScheduleEndTime, setAdScheduleEndTime] = useState("");
  const [publishingStoragePath, setPublishingStoragePath] = useState("");
  const [savingAdSettingsPath, setSavingAdSettingsPath] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [apkUploadProgress, setApkUploadProgress] = useState(0);
  const [apkVersionName, setApkVersionName] = useState("");
  const [apkVersionCode, setApkVersionCode] = useState("");
  const [apkReleaseNote, setApkReleaseNote] = useState("");
  const [apkForceUpdate, setApkForceUpdate] = useState(true);
  const [accountPurgePreview, setAccountPurgePreview] = useState<AccountPurgePreview | null>(null);
  const [scanningAccountUploads, setScanningAccountUploads] = useState(false);
  const [purgingAccountUploads, setPurgingAccountUploads] = useState(false);
  const [accountActionLoading, setAccountActionLoading] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const firebaseReady = hasFirebaseConfig();

  function currentAdPolicy(): AdPolicy {
    const dailyLimit = normalizeDailyLimit(adDailyLimit);
    return {
      placement: adPlacement,
      clickTarget: adClickTarget,
      playbackMode: adPlaybackMode,
      dailyLimit: adPlaybackMode === "daily_limit" ? dailyLimit : 0,
      scheduleStartDate: adScheduleStartDate,
      scheduleEndDate: adScheduleEndDate,
      scheduleStartTime: adScheduleStartTime,
      scheduleEndTime: adScheduleEndTime
    };
  }

  function adPolicyForFile(file: StorageAdFile): AdPolicy {
    const asset = adAssets.find((item) => item.id === assetIdFromStoragePath(file.fullPath));
    return adPolicyFromSources(file.customMetadata, asset as unknown as Record<string, unknown> | undefined);
  }

  function applyAdPolicyToForm(policy: AdPolicy) {
    setAdPlacement(policy.placement);
    setAdClickTarget(policy.clickTarget);
    setAdPlaybackMode(policy.playbackMode);
    setAdDailyLimit(String(policy.dailyLimit || 0));
    setAdScheduleStartDate(policy.scheduleStartDate);
    setAdScheduleEndDate(policy.scheduleEndDate);
    setAdScheduleStartTime(policy.scheduleStartTime);
    setAdScheduleEndTime(policy.scheduleEndTime);
  }

  useEffect(() => {
    if (!storageAdFiles.length) {
      setSelectedStorageAdPath("");
      return;
    }
    if (!selectedStorageAdPath || !storageAdFiles.some((file) => file.fullPath === selectedStorageAdPath)) {
      setSelectedStorageAdPath(storageAdFiles[0].fullPath);
    }
  }, [selectedStorageAdPath, storageAdFiles]);

  useEffect(() => {
    if (!selectedStorageAdPath) return;
    const file = storageAdFiles.find((item) => item.fullPath === selectedStorageAdPath);
    if (!file) return;
    applyAdPolicyToForm(adPolicyForFile(file));
  }, [selectedStorageAdPath, storageAdFiles, adAssets]);

  async function refreshAdDailyRollups() {
    if (!firebaseReady || !user || !admin) return;
    try {
      const { db } = getFirebaseServices();
      const yesterday = getYesterdayDateKey();
      const snapshot = await getDocs(query(collection(db, "ad_daily_rollups"), where("dateKey", "<=", yesterday), orderBy("dateKey", "desc"), limit(1500)));
      setAdDailyRollups(snapshot.docs.map((item) => normalizeAdDailyRollup(item.id, item.data())));
    } catch (error) {
      const message = error instanceof Error ? error.message : "ad_daily_rollups 조회 실패";
      setErrors((current) => [...current, `ad_daily_rollups 조회 실패: ${message}`]);
      setAdDailyRollups([]);
    }
  }

  useEffect(() => {
    if (!firebaseReady) return;

    const { auth, db } = getFirebaseServices();
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setAdmin(null);
        return;
      }

      if (await isMasterEmail(nextUser.email || "")) {
        setAdmin({
          uid: nextUser.uid,
          email: nextUser.email || "",
          displayName: nextUser.displayName || "A1 Master",
          role: "master",
          managedShops: ["*"]
        });
        return;
      }

      const adminSnap = await getDoc(doc(db, "global_admins", nextUser.uid)).catch(() => null);
      if (!adminSnap?.exists()) {
        setAdmin(null);
        return;
      }

      const data = adminSnap.data();
      setAdmin({
        uid: nextUser.uid,
        email: text(data.email, nextUser.email || ""),
        displayName: text(data.displayName || data.name, nextUser.displayName || ""),
        role: text(data.role, "developer"),
        managedShops: Array.isArray(data.managed_shops) ? data.managed_shops.map(String) : []
      });
    });

    return () => unsubscribe();
  }, [firebaseReady]);

  useEffect(() => {
    if (!firebaseReady || !user || !admin) return;
    const { db } = getFirebaseServices();
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      onSnapshot(
        query(collection(db, "businesses"), limit(300)),
        (snapshot) => {
          const rows = snapshot.docs.map((item) => normalizeBranch(item.id, item.data()));
          rows.sort((a, b) => a.businessName.localeCompare(b.businessName, "ko-KR"));
          setBranches(rows);
          setSelectedBizNum((current) => current || rows[0]?.bizNum || "");
        },
        (error) => setErrors((current) => [...current, `businesses 조회 실패: ${error.message}`])
      )
    );

    unsubscribers.push(
      onSnapshot(
        query(collection(db, "devices"), limit(500)),
        (snapshot) => setDevices(snapshot.docs.map((item) => normalizeDevice(item.id, item.data()))),
        (error) => setErrors((current) => [...current, `devices 조회 실패: ${error.message}`])
      )
    );

    unsubscribers.push(
      onSnapshot(
        query(collection(db, "ad_assets"), limit(200)),
        (snapshot) => setAdAssets(snapshot.docs.map((item) => normalizeAdAsset(item.id, item.data()))),
        () => setAdAssets([])
      )
    );

    unsubscribers.push(
      onSnapshot(
        query(collection(db, "ad_play_events"), orderBy("createdAt", "desc"), limit(400)),
        (snapshot) => setAdEvents(snapshot.docs.map((item) => normalizeAdEvent(item.id, item.data()))),
        () => setAdEvents([])
      )
    );

    unsubscribers.push(
      onSnapshot(
        query(collection(db, "app_releases"), limit(20)),
        (snapshot) => {
          const rows = snapshot.docs
            .map((item) => normalizeAppRelease(item.id, item.data()))
            .filter((release) => text(release.raw.status, "active") !== "deleted" && Boolean(release.apkUrl || release.storagePath));
          rows.sort((a, b) => b.versionCode - a.versionCode);
          setAppReleases(rows);
        },
        () => setAppReleases([])
      )
    );

    unsubscribers.push(
      onSnapshot(
        query(collection(db, "a1_audit_logs"), orderBy("createdAt", "desc"), limit(60)),
        (snapshot) => {
          setAuditLogs(
            snapshot.docs.map((item) => {
              const data = item.data();
              return {
                id: item.id,
                action: text(data.action),
                actorUid: text(data.actorUid),
                target: text(data.target),
                detail: text(data.detail),
                createdAt: dateText(data.createdAt)
              };
            })
          );
        },
        () => setAuditLogs([])
      )
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [firebaseReady, user, admin]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!firebaseReady || !user || !admin) return;

    const { rtdb } = getFirebaseServices();
    const unsubscribe = onValue(
      rtdbRef(rtdb, "device_presence"),
      (snapshot) => {
        setPresencePermissionDenied(false);
        const value = snapshot.val();
        if (!value || typeof value !== "object") {
          setPresenceByDeviceId({});
          return;
        }

        const rows = Object.entries(value as Record<string, unknown>).reduce<Record<string, DevicePresence>>((acc, [id, row]) => {
          acc[id] = normalizePresence(id, row);
          return acc;
        }, {});
        setPresenceByDeviceId(rows);
      },
      (error) => {
        setPresenceByDeviceId({});
        setPresencePermissionDenied(true);
        setErrors((current) => current.filter((item) => !item.startsWith("device_presence 조회 실패")));
        if (error.message && !error.message.toLowerCase().includes("permission_denied")) {
          setErrors((current) => [...current, `device_presence 조회 실패: ${error.message}`]);
        }
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, user, admin]);

  useEffect(() => {
    if (!firebaseReady || !user || !admin) return;
    refreshStorageAdFiles();
    refreshA3ApkFiles();
    refreshAdDailyRollups();
  }, [firebaseReady, user, admin]);

  const branchByBizNum = useMemo(() => new Map(branches.map((branch) => [branch.bizNum, branch])), [branches]);
  const selectedBranch = branchByBizNum.get(selectedBizNum) || branches[0];

  useEffect(() => {
    setAccountPurgePreview(null);
    setPurgeConfirmText("");
  }, [selectedBranch?.ownerUid, selectedBranch?.bizNum]);

  const filteredBranches = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return branches;
    return branches.filter((branch) => {
      return `${branch.bizNum} ${branch.businessName} ${branch.storeName} ${branch.ownerUid} ${branch.category} ${branch.address} ${branch.regionKey} ${branch.status} ${branch.accountStatus} ${branch.a4Status}`.toLowerCase().includes(keyword);
    });
  }, [branches, search]);

  const selectedDevices = useMemo(() => {
    if (!selectedBranch) return [];
    return devices.filter((device) => device.bizNum === selectedBranch.bizNum || device.ownerUid === selectedBranch.ownerUid);
  }, [devices, selectedBranch]);

  const adRegionOptions = useMemo(() => {
    return Array.from(new Set(branches.map((branch) => branch.regionKey).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko-KR"));
  }, [branches]);

  const adCategoryOptions = useMemo(() => {
    return Array.from(new Set(branches.map((branch) => branch.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko-KR"));
  }, [branches]);

  useEffect(() => {
    if (!selectedAdRegionKey && adRegionOptions.length) setSelectedAdRegionKey(adRegionOptions[0]);
  }, [adRegionOptions, selectedAdRegionKey]);

  useEffect(() => {
    if (!selectedAdCategory && adCategoryOptions.length) setSelectedAdCategory(adCategoryOptions[0]);
  }, [adCategoryOptions, selectedAdCategory]);

  const adTargetBranches = useMemo(() => {
    if (adTargetMode === "global") return branches;
    if (adTargetMode === "store") return selectedBranch ? [selectedBranch] : [];
    if (adTargetMode === "region") return branches.filter((branch) => branch.regionKey === selectedAdRegionKey);
    if (adTargetMode === "category") return branches.filter((branch) => branch.category === selectedAdCategory);
    return branches.filter((branch) => branch.regionKey === selectedAdRegionKey && branch.category === selectedAdCategory);
  }, [adTargetMode, branches, selectedAdCategory, selectedAdRegionKey, selectedBranch]);

  const adTargetDevices = useMemo(() => {
    const bizNums = new Set(adTargetBranches.map((branch) => branch.bizNum).filter(Boolean));
    const ownerUids = new Set(adTargetBranches.map((branch) => branch.ownerUid).filter(Boolean));
    return devices.filter((device) => bizNums.has(device.bizNum) || ownerUids.has(device.ownerUid));
  }, [adTargetBranches, devices]);

  const adTargetLabel = useMemo(() => {
    if (adTargetMode === "global") return "전체 매장";
    if (adTargetMode === "store") return selectedBranch?.businessName || selectedBranch?.bizNum || "선택 매장";
    if (adTargetMode === "region") return selectedAdRegionKey || "권역 미선택";
    if (adTargetMode === "category") return selectedAdCategory || "카테고리 미선택";
    return [selectedAdRegionKey, selectedAdCategory].filter(Boolean).join(" / ") || "권역+카테고리 미선택";
  }, [adTargetMode, selectedAdCategory, selectedAdRegionKey, selectedBranch]);

  const selectedAdEvents = useMemo(() => {
    if (!selectedBranch) return [];
    return adEvents.filter((event) => event.bizNum === selectedBranch.bizNum);
  }, [adEvents, selectedBranch]);

  const adCountsByAsset = useMemo(() => {
    const map = new Map<string, { total: number; completed: number; failed: number }>();
    const yesterday = getYesterdayDateKey();
    adDailyRollups
      .filter((rollup) => !rollup.dateKey || rollup.dateKey <= yesterday)
      .forEach((rollup) => {
      const key = rollup.assetId || rollup.adId || "unknown";
      const current = map.get(key) || { total: 0, completed: 0, failed: 0 };
      current.total += rollup.totalCount;
      current.completed += rollup.completedCount;
      current.failed += rollup.failedCount;
      map.set(key, current);
    });
    return map;
  }, [adDailyRollups]);

  const onlineDevices = devices.filter((device) => resolveDevicePresence(device, presenceByDeviceId[device.id], nowMs).status === "online").length;
  const suspendedBranches = branches.filter((branch) => branch.a4Status === "suspended").length;
  const todayEvents = adEvents.filter((event) => event.startedAt.includes(todayKey())).length;
  const storageVideoCount = storageAdFiles.filter((file) => file.contentType.startsWith("video/") || file.name.toLowerCase().endsWith(".mp4")).length;
  const apkFileCount = apkFiles.filter((file) => file.name.toLowerCase().endsWith(".apk")).length;
  const a3Release = appReleases.find((release) => release.id === "a3");

  const menu = [
    { key: "overview" as const, label: "대시보드", icon: Gauge, count: branches.length },
    { key: "stores" as const, label: "매장 관제", icon: Store, count: branches.length, children: [{ key: "devices" as const, label: "연결 기기", icon: Laptop, count: selectedDevices.length }] },
    { key: "control" as const, label: "사용 제어", icon: Ban, count: suspendedBranches },
    { key: "broadcast" as const, label: "매장 광고 송출", icon: Eye, count: selectedAdEvents.length },
    { key: "storage" as const, label: "Storage 광고 파일", icon: HardDrive, count: storageVideoCount },
    { key: "releases" as const, label: "A3 APK 배포", icon: Upload, count: apkFileCount },
    { key: "database" as const, label: "취합 DB", icon: Database, count: 6 },
    { key: "audit" as const, label: "감사 로그", icon: AlertTriangle, count: auditLogs.length }
  ];

  const storeScopedSections: SectionKey[] = ["overview", "stores", "devices", "control", "broadcast", "storage"];
  const showStoreSelector = storeScopedSections.includes(activeSection);

  async function refreshStorageAdFiles() {
    if (!firebaseReady) return;
    setLoadingStorage(true);
    try {
      const { storage } = getFirebaseServices();
      const root = storageRef(storage, "ad_videos");
      const result = await listAll(root);
      const files = await Promise.all(
        result.items.map(async (item) => {
          const [metadata, url] = await Promise.all([getMetadata(item), getDownloadURL(item).catch(() => "")]);
          return {
            id: item.fullPath,
            name: item.name,
            fullPath: item.fullPath,
            bucket: item.bucket,
            contentType: metadata.contentType || "-",
            size: metadata.size || 0,
            updated: metadata.updated ? new Date(metadata.updated).toLocaleString("ko-KR") : "-",
            url,
            customMetadata: metadata.customMetadata || {}
          };
        })
      );
      files.sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
      setStorageAdFiles(files);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storage ad_videos 조회 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setLoadingStorage(false);
    }
  }

  async function refreshA3ApkFiles() {
    if (!firebaseReady) return;
    setLoadingApks(true);
    try {
      const { storage } = getFirebaseServices();
      const root = storageRef(storage, "app_releases/a3");
      const result = await listAll(root);
      const files = await Promise.all(
        result.items.map(async (item) => {
          const [metadata, url] = await Promise.all([getMetadata(item), getDownloadURL(item).catch(() => "")]);
          return {
            id: item.fullPath,
            name: item.name,
            fullPath: item.fullPath,
            bucket: item.bucket,
            contentType: metadata.contentType || "application/vnd.android.package-archive",
            size: metadata.size || 0,
            updated: metadata.updated ? new Date(metadata.updated).toLocaleString("ko-KR") : "-",
            url,
            customMetadata: metadata.customMetadata || {}
          };
        })
      );
      files.sort((a, b) => b.name.localeCompare(a.name, "ko-KR"));
      setApkFiles(files);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storage app_releases/a3 조회 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setLoadingApks(false);
    }
  }

  async function uploadStorageAdFile(file: File | null) {
    if (!file || !firebaseReady || !user || !admin) return;

    setUploadingStorage(true);
    setUploadProgress(0);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const policy = defaultAdPolicy();
      const policyMetadata = adPolicyStorageMetadata(policy);
      const policyFields = adPolicyFirestoreFields(policy);
      const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
      const storagePath = `ad_videos/${Date.now()}_${safeName}`;
      const fileRef = storageRef(storage, storagePath);
      const uploadTask = uploadBytesResumable(fileRef, file, {
        contentType: file.type || "video/mp4",
        customMetadata: {
          source: "a1",
          ...policyMetadata,
          uploadedBy: user.email || user.uid
        }
      });

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setUploadProgress(progress);
          },
          reject,
          () => resolve()
        );
      });

      const url = await getDownloadURL(fileRef).catch(() => "");
      const assetId = assetIdFromStoragePath(storagePath);

      await setDoc(doc(db, "ad_assets", assetId), {
        title: file.name,
        name: file.name,
        fileName: file.name,
        storagePath,
        storageUrl: url,
        url,
        contentType: file.type || "video/mp4",
        size: file.size,
        status: "active",
        ...policyFields,
        source: "a1_storage_upload",
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "ad_assets 저장 실패";
        setErrors((current) => [...current, `ad_assets 저장 실패: ${message}`]);
      });

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "storage.ad_video.upload",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: storagePath,
        detail: `${file.name} / ${bytesText(file.size)}`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      setSelectedStorageAdPath(storagePath);
      applyAdPolicyToForm(policy);
      await refreshStorageAdFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "광고 파일 업로드 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setUploadingStorage(false);
      setUploadProgress(0);
    }
  }

  async function uploadA3Apk(file: File | null) {
    if (!file || !firebaseReady || !user || !admin) return;

    const versionName = apkVersionName.trim();
    const versionCode = Number(apkVersionCode.trim());
    if (!versionName || !Number.isFinite(versionCode) || versionCode <= 0) {
      setErrors((current) => [...current, "A3 APK 버전명과 versionCode를 먼저 입력하세요."]);
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".apk")) {
      setErrors((current) => [...current, "APK 파일만 업로드할 수 있습니다."]);
      return;
    }

    setUploadingApk(true);
    setApkUploadProgress(0);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
      const storagePath = `app_releases/a3/a3_${versionName}_${versionCode}_${Date.now()}_${safeName}`;
      const fileRef = storageRef(storage, storagePath);
      const uploadTask = uploadBytesResumable(fileRef, file, {
        contentType: "application/vnd.android.package-archive",
        customMetadata: {
          appId: "a3",
          versionName,
          versionCode: String(versionCode),
          source: "a1",
          uploadedBy: user.email || user.uid
        }
      });

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setApkUploadProgress(progress);
          },
          reject,
          () => resolve()
        );
      });

      const apkUrl = await getDownloadURL(fileRef);
      const releaseFileId = assetIdFromStoragePath(storagePath);
      const releaseData = {
        appId: "a3",
        versionName,
        versionCode,
        apkUrl,
        url: apkUrl,
        storagePath,
        fileName: file.name,
        contentType: "application/vnd.android.package-archive",
        size: file.size,
        forceUpdate: true,
        installMode: "forced",
        autoUpdate: true,
        releaseNote: apkReleaseNote.trim(),
        status: "uploaded",
        storageDeleted: false,
        uploadedBy: user.email || user.uid,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      };

      await setDoc(doc(db, "app_release_files", releaseFileId), {
        ...releaseData,
        latest: false,
        published: false,
        storageDeleted: false
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "app_release_files 저장 실패";
        setErrors((current) => [...current, `app_release_files 저장 실패: ${message}`]);
      });
      await setDoc(doc(collection(db, "app_release_history")), releaseData).catch(() => undefined);
      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "app_release.a3.upload",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: storagePath,
        detail: `A3 APK ${versionName}+${versionCode} 업로드`,
        createdAt: serverTimestamp()
      });

      setApkVersionName("");
      setApkVersionCode("");
      setApkReleaseNote("");
      setApkForceUpdate(true);
      await refreshA3ApkFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "A3 APK 업로드 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setUploadingApk(false);
      setApkUploadProgress(0);
    }
  }

  async function deployA3ApkFile(file: StorageAdFile) {
    if (!firebaseReady || !user || !admin || !file.fullPath || !file.url) return;

    const { versionName, versionCode } = parseA3ApkInfo(file);
    if (!versionName || versionCode <= 0) {
      setErrors((current) => [...current, `${file.name}: APK 버전 정보를 찾지 못했습니다. 업로드 시 versionName/versionCode를 입력한 파일만 배포할 수 있습니다.`]);
      return;
    }

    const confirmed = window.confirm(
      `"${file.name}" APK를 A3 최신 배포로 확정할까요?\n\nA3가 업데이트 감시 기능을 가진 버전이면 versionCode ${versionCode}를 보고 업데이트를 시작합니다.`
    );
    if (!confirmed) return;

    setDeployingApkPath(file.fullPath);
    setErrors([]);

    try {
      const { db } = getFirebaseServices();
      const releaseFileId = assetIdFromStoragePath(file.fullPath);
      const releaseNote = apkReleaseNote.trim() || text(file.customMetadata?.releaseNote || file.customMetadata?.release_note);
      const releaseData = {
        appId: "a3",
        versionName,
        versionCode,
        apkUrl: file.url,
        url: file.url,
        storagePath: file.fullPath,
        fileName: file.name,
        contentType: file.contentType,
        size: file.size,
        forceUpdate: true,
        installMode: "forced",
        autoUpdate: true,
        releaseNote,
        status: "active",
        storageDeleted: false,
        deployedBy: user.email || user.uid,
        updatedAt: serverTimestamp(),
        deployedAt: serverTimestamp()
      };

      await setDoc(doc(db, "app_releases", "a3"), releaseData, { merge: true });
      await setDoc(
        doc(db, "app_release_files", releaseFileId),
        {
          ...releaseData,
          latest: true,
          published: true,
          publishedAt: serverTimestamp()
        },
        { merge: true }
      );
      await setDoc(doc(collection(db, "app_release_history")), releaseData).catch(() => undefined);
      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "app_release.a3.deploy",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: file.fullPath,
        detail: `A3 APK ${versionName}+${versionCode} 배포 확정`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "A3 APK 배포 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setDeployingApkPath("");
    }
  }

  async function deleteA3ApkFile(file: StorageAdFile) {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;

    const confirmed = window.confirm(`"${file.name}" APK 파일을 삭제할까요?\nStorage 파일을 삭제하고 A1 배포 메타데이터에는 삭제 상태를 기록합니다.`);
    if (!confirmed) return;

    setDeletingApkPath(file.fullPath);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const releaseFileId = assetIdFromStoragePath(file.fullPath);

      await deleteObject(storageRef(storage, file.fullPath)).catch((error) => {
        if (!isStorageObjectNotFound(error)) throw error;
      });

      await setDoc(
        doc(db, "app_release_files", releaseFileId),
        {
          appId: "a3",
          fileName: file.name,
          storagePath: file.fullPath,
          apkUrl: file.url,
          url: file.url,
          contentType: file.contentType,
          size: file.size,
          status: "deleted",
          storageDeleted: true,
          deletedBy: user.uid,
          deletedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch((error) => {
        const message = error instanceof Error ? error.message : "app_release_files 삭제 상태 저장 실패";
        setErrors((current) => [...current, `app_release_files 삭제 상태 저장 실패: ${message}`]);
      });

      if (a3Release?.storagePath === file.fullPath) {
        await setDoc(
          doc(db, "app_releases", "a3"),
          {
            appId: "a3",
            versionName: "",
            versionCode: 0,
            apkUrl: "",
            url: "",
            storagePath: "",
            fileName: "",
            size: 0,
            forceUpdate: false,
            releaseNote: "",
            status: "deleted",
            storageDeleted: true,
            deletedBy: user.uid,
            deletedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          },
          { merge: true }
        ).catch((error) => {
          const message = error instanceof Error ? error.message : "app_releases/a3 삭제 상태 저장 실패";
          setErrors((current) => [...current, `app_releases/a3 삭제 상태 저장 실패: ${message}`]);
        });
      }

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "app_release.a3.delete",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: file.fullPath,
        detail: `${file.name} / ${bytesText(file.size)}`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      await refreshA3ApkFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "A3 APK 삭제 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setDeletingApkPath("");
    }
  }

  async function syncStorageAdAssets() {
    if (!firebaseReady || !user || !admin || !storageAdFiles.length) return;

    setSyncingAssets(true);
    setErrors([]);

    try {
      const { db } = getFirebaseServices();
      await Promise.all(
        storageAdFiles.map((file) => {
          const assetId = assetIdFromStoragePath(file.fullPath);
          return setDoc(
            doc(db, "ad_assets", assetId),
            {
              title: file.name,
              name: file.name,
              fileName: file.name,
              storagePath: file.fullPath,
              storageUrl: file.url,
              url: file.url,
              contentType: file.contentType,
              size: file.size,
              status: "active",
              ...adPolicyFirestoreFields(adPolicyFromSources(file.customMetadata)),
              source: "a1_storage_sync",
              syncedBy: user.uid,
              syncedAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        })
      );

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "storage.ad_assets.sync",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: "ad_videos",
        detail: `${storageAdFiles.length}개 Storage 광고 파일을 ad_assets와 동기화`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storage 광고 파일 DB 동기화 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setSyncingAssets(false);
    }
  }

  async function setA3PlaylistDocument(targetRef: DocumentReference, entries: A3AdVideoEntry[]) {
    await setDoc(
      targetRef,
      {
        ad_videos: entries,
        adDisplayPolicy: {
          version: 1,
          analysisMode: "daily_until_yesterday",
          scheduleMode: "local_device",
          defaultPlaybackMode: "rolling",
          fullscreenPlacement: "portrait_fullscreen",
          clickTargets: {
            hotdeal: adLandingUrl("hotdeal"),
            luxury: adLandingUrl("luxury")
          }
        },
        source: "a1",
        updatedBy: user?.uid || "a1",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  async function upsertAdFileInA3Document(targetRef: DocumentReference, file: StorageAdFile, policy: AdPolicy) {
    const snapshot = await getDoc(targetRef).catch(() => null);
    const data = snapshot?.exists() ? (snapshot.data() as Record<string, unknown>) : {};
    const rawList = Array.isArray(data.ad_videos) ? data.ad_videos : [];
    const nextEntries = rawList
      .filter((entry) => !adEntryMatchesFile(entry, file))
      .map(normalizeA3AdEntry)
      .filter((entry): entry is A3AdVideoEntry => Boolean(entry));

    nextEntries.push(a3AdEntryFromFile(file, policy));
    await setA3PlaylistDocument(targetRef, nextEntries);
  }

  async function upsertAdFileForDevices(targetDevices: Device[], file: StorageAdFile, policy: AdPolicy) {
    if (!targetDevices.length) return;

    const { db } = getFirebaseServices();
    await Promise.allSettled(
      targetDevices.map((device) =>
        upsertAdFileInA3Document(doc(db, "devices", device.id), file, policy)
      )
    );
  }

  async function removeAdFileFromA3Document(targetRef: DocumentReference, file: StorageAdFile) {
    const snapshot = await getDoc(targetRef).catch(() => null);
    if (!snapshot?.exists()) return;

    const data = snapshot.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.ad_videos) ? data.ad_videos : [];
    if (!rawList.length) return;

    const remainingEntries = rawList
      .filter((entry) => !adEntryMatchesFile(entry, file))
      .map(normalizeA3AdEntry)
      .filter((entry): entry is A3AdVideoEntry => Boolean(entry));

    await setDoc(
      targetRef,
      {
        ad_videos: remainingEntries,
        source: "a1",
        updatedBy: user?.uid || "a1",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  async function publishStorageAdFile(file: StorageAdFile, scope: AdDeliveryScope = "global") {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;
    if (!file.url) {
      setErrors((current) => [...current, `${file.name}: Storage download URL이 없어 A3 송출 목록에 반영하지 못했습니다.`]);
      return;
    }

      const targetDevices = scope === "global" ? [] : adTargetDevices;
      const targetBranches = scope === "global" ? branches : adTargetBranches;
      const targetBizNums = targetBranches.map((branch) => branch.bizNum).filter(Boolean);
      const targetOwnerUids = targetBranches.map((branch) => branch.ownerUid).filter(Boolean);
      const targetName = scope === "global" ? "전체 매장" : adTargetLabel;
      if (scope !== "global" && !targetDevices.length) {
      setErrors((current) => [...current, `${adDeliveryScopeLabel(scope)} 대상에 연결된 A3 기기가 없어 광고 URL을 반영하지 못했습니다.`]);
      return;
    }

    setPublishingStoragePath(file.fullPath);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const assetId = assetIdFromStoragePath(file.fullPath);
      const policy = currentAdPolicy();
      await updateMetadata(storageRef(storage, file.fullPath), {
        customMetadata: {
          ...(file.customMetadata || {}),
          ...adPolicyStorageMetadata(policy),
          updatedBy: user.email || user.uid
        }
      }).catch(() => undefined);

      if (scope === "global") {
        await upsertAdFileInA3Document(doc(db, "global_campaigns", "current_ads"), file, policy);
      } else {
        await upsertAdFileForDevices(targetDevices, file, policy);
      }

      await setDoc(
        doc(db, "ad_assets", assetId),
        {
          title: file.name,
          name: file.name,
          fileName: file.name,
          storagePath: file.fullPath,
          storageUrl: file.url,
          url: file.url,
          contentType: file.contentType,
          size: file.size,
          status: "active",
          published: true,
          publishedScope: scope,
          publishedTargetBizNums: scope === "global" ? ["*"] : targetBizNums,
          publishedTargetOwnerUids: scope === "global" ? ["*"] : targetOwnerUids,
          publishedTargetRegionKey: scope === "region" || scope === "segment" ? selectedAdRegionKey : "",
          publishedTargetCategory: scope === "category" || scope === "segment" ? selectedAdCategory : "",
          publishedTargetName: targetName,
          publishedStoreCount: scope === "global" ? branches.length : targetBranches.length,
          publishedDeviceCount: scope === "global" ? devices.length : targetDevices.length,
          ...adPolicyFirestoreFields(policy),
          source: "a1_storage_publish",
          updatedBy: user.uid,
          lastPublishedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch((error) => {
        const message = error instanceof Error ? error.message : "ad_assets publish metadata save failed";
        setErrors((current) => [...current, `ad_assets 송출 메타 저장 실패: ${message}`]);
      });

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "storage.ad_video.publish",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: scope === "global" ? "global_campaigns/current_ads" : `devices/${targetDevices.length}`,
        detail: `${file.name} -> ${adDeliveryScopeLabel(scope)} ${targetName} / 매장 ${targetBranches.length}개 / A3 ${scope === "global" ? devices.length : targetDevices.length}대 playlist upsert`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      await refreshStorageAdFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "A3 광고 송출 목록 반영 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setPublishingStoragePath("");
    }
  }

  async function updateAdFilePolicyInA3Document(targetRef: DocumentReference, file: StorageAdFile, policy: AdPolicy) {
    const snapshot = await getDoc(targetRef).catch(() => null);
    if (!snapshot?.exists()) return;

    const data = snapshot.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.ad_videos) ? data.ad_videos : [];
    if (!rawList.length) return;

    let changed = false;
    const nextEntries = rawList
      .map((entry) => {
        if (adEntryMatchesFile(entry, file)) {
          changed = true;
          const existingUrl = adUrlFromEntry(entry);
          return a3AdEntryFromFile({ ...file, url: file.url || existingUrl }, policy);
        }
        return normalizeA3AdEntry(entry);
      })
      .filter((entry): entry is A3AdVideoEntry => Boolean(entry));

    if (!changed) return;

    await setDoc(
      targetRef,
      {
        ad_videos: nextEntries,
        source: "a1",
        updatedBy: user?.uid || "a1",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  async function updateStorageAdFilePolicyInA3(file: StorageAdFile, policy: AdPolicy) {
    const { db } = getFirebaseServices();
    await updateAdFilePolicyInA3Document(doc(db, "global_campaigns", "current_ads"), file, policy).catch((error) => {
      const message = error instanceof Error ? error.message : "global ad_videos policy update failed";
      setErrors((current) => [...current, `global_campaigns/current_ads 설정 반영 실패: ${message}`]);
    });

    await Promise.allSettled(
      devices.map((device) =>
        updateAdFilePolicyInA3Document(doc(db, "devices", device.id), file, policy).catch((error) => {
          const message = error instanceof Error ? error.message : "device ad_videos policy update failed";
          setErrors((current) => [...current, `devices/${device.id} 설정 반영 실패: ${message}`]);
        })
      )
    );
  }

  async function saveStorageAdSettings(file: StorageAdFile) {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;

    setSavingAdSettingsPath(file.fullPath);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const policy = currentAdPolicy();
      const assetId = assetIdFromStoragePath(file.fullPath);

      await updateMetadata(storageRef(storage, file.fullPath), {
        customMetadata: {
          ...(file.customMetadata || {}),
          ...adPolicyStorageMetadata(policy),
          updatedBy: user.email || user.uid
        }
      });

      await setDoc(
        doc(db, "ad_assets", assetId),
        {
          title: file.name,
          name: file.name,
          fileName: file.name,
          storagePath: file.fullPath,
          storageUrl: file.url,
          url: file.url,
          contentType: file.contentType,
          size: file.size,
          status: "active",
          ...adPolicyFirestoreFields(policy),
          source: "a1_storage_settings",
          updatedBy: user.uid,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      await updateStorageAdFilePolicyInA3(file, policy);

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "storage.ad_video.settings",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: file.fullPath,
        detail: `${file.name} / ${adPlaybackModeLabel(policy.playbackMode)} / ${adScheduleSummary(policy)}`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      await refreshStorageAdFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "광고 설정 저장 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setSavingAdSettingsPath("");
    }
  }

  async function removeStorageAdFileFromA3(file: StorageAdFile) {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;

    const { db } = getFirebaseServices();
    await removeAdFileFromA3Document(doc(db, "global_campaigns", "current_ads"), file).catch((error) => {
      const message = error instanceof Error ? error.message : "global ad_videos remove failed";
      setErrors((current) => [...current, `global_campaigns/current_ads 삭제 반영 실패: ${message}`]);
    });

    await Promise.allSettled(
      devices.map((device) =>
        removeAdFileFromA3Document(doc(db, "devices", device.id), file).catch((error) => {
          const message = error instanceof Error ? error.message : "device ad_videos remove failed";
          setErrors((current) => [...current, `devices/${device.id} 삭제 반영 실패: ${message}`]);
        })
      )
    );
  }

  async function stopStorageAdFileBroadcast(file: StorageAdFile) {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;

    setPublishingStoragePath(file.fullPath);
    setErrors([]);

    try {
      const { db } = getFirebaseServices();
      const assetId = assetIdFromStoragePath(file.fullPath);

      await removeStorageAdFileFromA3(file);

      await setDoc(
        doc(db, "ad_assets", assetId),
        {
          title: file.name,
          name: file.name,
          fileName: file.name,
          storagePath: file.fullPath,
          storageUrl: file.url,
          url: file.url,
          contentType: file.contentType,
          size: file.size,
          published: false,
          publishedScope: "none",
          publishedDeviceCount: 0,
          source: "a1_storage_stop",
          updatedBy: user.uid,
          stoppedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch((error) => {
        const message = error instanceof Error ? error.message : "ad_assets stop metadata save failed";
        setErrors((current) => [...current, `ad_assets 송출 중지 저장 실패: ${message}`]);
      });

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "storage.ad_video.stop",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: file.fullPath,
        detail: `${file.name} broadcast stopped`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      await refreshStorageAdFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "광고 송출 중지 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setPublishingStoragePath("");
    }
  }

  async function deleteStorageAdFile(file: StorageAdFile) {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;

    const confirmed = window.confirm(`"${file.name}" 광고 파일을 삭제할까요?\nStorage 파일은 삭제되고, 과거 송출 로그는 유지됩니다.`);
    if (!confirmed) return;

    setDeletingStoragePath(file.fullPath);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const assetId = assetIdFromStoragePath(file.fullPath);

      await deleteObject(storageRef(storage, file.fullPath)).catch((error) => {
        if (!isStorageObjectNotFound(error)) throw error;
      });

      await removeStorageAdFileFromA3(file);

      await setDoc(
        doc(db, "ad_assets", assetId),
        {
          title: file.name,
          name: file.name,
          fileName: file.name,
          storagePath: file.fullPath,
          storageUrl: file.url,
          url: file.url,
          contentType: file.contentType,
          size: file.size,
          status: "deleted",
          storageDeleted: true,
          deletedBy: user.uid,
          deletedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch((error) => {
        const message = error instanceof Error ? error.message : "ad_assets 삭제 상태 저장 실패";
        setErrors((current) => [...current, `ad_assets 삭제 상태 저장 실패: ${message}`]);
      });

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "storage.ad_video.delete",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: file.fullPath,
        detail: `${file.name} / ${bytesText(file.size)}`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      await refreshStorageAdFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storage 광고 파일 삭제 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setDeletingStoragePath("");
    }
  }

  async function scanSelectedAccountUploads() {
    if (!firebaseReady || !user || !admin || !selectedBranch?.ownerUid) return;

    setScanningAccountUploads(true);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const uid = selectedBranch.ownerUid;
      const files = await listStorageFilesRecursive(storageRef(storage, `user_uploads/${uid}`));
      files.sort((a, b) => b.updated.localeCompare(a.updated, "ko-KR"));

      const [userSnap, deviceSnap] = await Promise.all([
        getDoc(doc(db, "users", uid)).catch(() => null),
        getDocs(query(collection(db, "devices"), where("owner_uid", "==", uid))).catch(() => null)
      ]);

      const userData = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : {};
      let playlistRefCount = countUploadedMediaRefs(userData.master_playlist, files) + countUploadedMediaRefs(userData.playlist, files);
      deviceSnap?.docs.forEach((deviceDoc) => {
        const data = deviceDoc.data() as Record<string, unknown>;
        playlistRefCount += countUploadedMediaRefs(data.playlist, files);
        playlistRefCount += countUploadedMediaRefs(data.ad_videos, files);
      });

      setAccountPurgePreview({
        uid,
        bizNum: selectedBranch.bizNum,
        storageFiles: files,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        deviceCount: deviceSnap?.docs.length || 0,
        playlistRefCount,
        scannedAt: new Date().toLocaleString("ko-KR")
      });
      setPurgeConfirmText("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "계정 업로드 자료 스캔 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setScanningAccountUploads(false);
    }
  }

  async function changeAccountStatus(nextStatus: "active" | "suspended") {
    if (!firebaseReady || !user || !admin || !selectedBranch?.ownerUid) return;

    const detail = nextStatus === "suspended" ? reason.trim() || "관리자 계정 정지 처리" : "관리자 계정 정지 해제";
    setAccountActionLoading(true);
    setErrors([]);

    try {
      const { db, rtdb } = getFirebaseServices();
      const uid = selectedBranch.ownerUid;
      const deviceSnap = await getDocs(query(collection(db, "devices"), where("owner_uid", "==", uid))).catch(() => null);
      const branchRefs = Array.from(new Set([selectedBranch.id, selectedBranch.bizNum].filter(Boolean))).map((id) => doc(db, "businesses", id));

      const accountFields =
        nextStatus === "suspended"
          ? {
              account_status: "suspended",
              accountStatus: "suspended",
              account_suspended_reason: detail,
              account_suspended_at: serverTimestamp(),
              account_suspended_by: user.uid,
              updated_at: serverTimestamp()
            }
          : {
              account_status: "active",
              accountStatus: "active",
              account_resumed_at: serverTimestamp(),
              account_resumed_by: user.uid,
              updated_at: serverTimestamp()
            };

      await Promise.all([
        setDoc(doc(db, "users", uid), accountFields, { merge: true }),
        ...branchRefs.map((branchRef) => setDoc(branchRef, accountFields, { merge: true })),
        ...(deviceSnap?.docs || []).map((deviceDoc) => setDoc(deviceDoc.ref, accountFields, { merge: true }))
      ]);

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: nextStatus === "suspended" ? "account.suspend" : "account.resume",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: uid,
        detail: `${selectedBranch.businessName} / ${selectedBranch.bizNum} / ${detail}`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      await set(push(rtdbRef(rtdb, `businesses/${selectedBranch.bizNum}/signals`)), {
        type: "account_status",
        status: nextStatus,
        ownerUid: uid,
        message: nextStatus === "suspended" ? "계정이 정지되었습니다. 관리자에게 문의하세요." : "계정 사용이 재개되었습니다.",
        reason: detail,
        source: "a1",
        actorUid: user.uid,
        timestamp: Date.now()
      }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "계정 상태 변경 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setAccountActionLoading(false);
    }
  }

  async function purgeSelectedAccountUploads() {
    if (!firebaseReady || !user || !admin || !selectedBranch?.ownerUid) return;

    const uid = selectedBranch.ownerUid;
    if (purgeConfirmText.trim() !== uid && purgeConfirmText.trim() !== selectedBranch.bizNum) {
      setErrors((current) => [...current, "삭제 확인을 위해 owner UID 또는 사업자등록번호를 정확히 입력하세요."]);
      return;
    }

    const preview = accountPurgePreview?.uid === uid ? accountPurgePreview : null;
    const confirmed = window.confirm(`${selectedBranch.businessName} 계정 업로드 자료를 삭제할까요?\n\nStorage 파일 ${preview?.storageFiles.length || 0}개, ${bytesText(preview?.totalBytes || 0)}가 삭제되고 playlist 참조가 제거됩니다.`);
    if (!confirmed) return;

    setPurgingAccountUploads(true);
    setErrors([]);

    try {
      const { db, storage } = getFirebaseServices();
      const files = preview?.storageFiles.length ? preview.storageFiles : await listStorageFilesRecursive(storageRef(storage, `user_uploads/${uid}`));
      const deviceSnap = await getDocs(query(collection(db, "devices"), where("owner_uid", "==", uid))).catch(() => null);
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef).catch(() => null);
      const userData = userSnap?.exists() ? (userSnap.data() as Record<string, unknown>) : {};
      const branchRefs = Array.from(new Set([selectedBranch.id, selectedBranch.bizNum].filter(Boolean))).map((id) => doc(db, "businesses", id));
      const jobRef = doc(collection(db, "account_purge_jobs"));

      await setDoc(jobRef, {
        uid,
        bizNum: selectedBranch.bizNum,
        status: "running",
        storageFileCount: files.length,
        storageBytes: files.reduce((sum, file) => sum + file.size, 0),
        startedBy: user.uid,
        startedAt: serverTimestamp()
      });

      const userUpdates: Record<string, unknown> = {
        upload_purge_status: "running",
        upload_purge_started_at: serverTimestamp(),
        upload_purge_started_by: user.uid,
        updated_at: serverTimestamp()
      };
      if (Array.isArray(userData.master_playlist)) userUpdates.master_playlist = filterUploadedMediaList(userData.master_playlist, files);
      if (Array.isArray(userData.playlist)) userUpdates.playlist = filterUploadedMediaList(userData.playlist, files);
      await setDoc(userRef, userUpdates, { merge: true });

      await Promise.all(
        (deviceSnap?.docs || []).map((deviceDoc) => {
          const data = deviceDoc.data() as Record<string, unknown>;
          const updates: Record<string, unknown> = {
            mediaPurgeRequestedAt: serverTimestamp(),
            mediaPurgeReason: "account_upload_purge",
            updated_at: serverTimestamp()
          };
          if (Array.isArray(data.playlist)) updates.playlist = filterUploadedMediaList(data.playlist, files);
          if (Array.isArray(data.ad_videos)) updates.ad_videos = filterUploadedMediaList(data.ad_videos, files);
          return setDoc(deviceDoc.ref, updates, { merge: true });
        })
      );

      const deleteResults = await Promise.allSettled(
        files.map((file) =>
          deleteObject(storageRef(storage, file.fullPath)).catch((error) => {
            if (!isStorageObjectNotFound(error)) throw error;
          })
        )
      );
      const deletedCount = deleteResults.filter((result) => result.status === "fulfilled").length;
      const failedCount = deleteResults.length - deletedCount;

      const completedFields = {
        upload_purge_status: failedCount ? "partial" : "completed",
        upload_purged_at: serverTimestamp(),
        upload_purged_by: user.uid,
        purged_upload_count: deletedCount,
        purged_upload_bytes: files.reduce((sum, file) => sum + file.size, 0),
        updated_at: serverTimestamp()
      };
      await Promise.all([
        setDoc(userRef, completedFields, { merge: true }),
        ...branchRefs.map((branchRef) => setDoc(branchRef, completedFields, { merge: true })),
        setDoc(
          jobRef,
          {
            status: failedCount ? "partial" : "completed",
            deletedFileCount: deletedCount,
            failedFileCount: failedCount,
            touchedDeviceCount: deviceSnap?.docs.length || 0,
            completedAt: serverTimestamp()
          },
          { merge: true }
        )
      ]);

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action: "account.uploads.purge",
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: uid,
        detail: `${selectedBranch.businessName} / ${selectedBranch.bizNum} / deleted ${deletedCount}/${files.length} / ${bytesText(files.reduce((sum, file) => sum + file.size, 0))}`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);

      setAccountPurgePreview(null);
      setPurgeConfirmText("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "계정 업로드 자료 삭제 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setPurgingAccountUploads(false);
    }
  }

  async function handleLogin() {
    if (!firebaseReady) return;
    setErrors([]);
    try {
      const { auth, googleProvider } = getFirebaseServices();
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google 로그인 실패";
      setErrors((current) => [...current, message]);
    }
  }

  async function handleLogout() {
    if (!firebaseReady) return;
    setErrors([]);
    try {
      const { auth } = getFirebaseServices();
      await signOut(auth);
    } catch (error) {
      const message = error instanceof Error ? error.message : "로그아웃 실패";
      setErrors((current) => [...current, message]);
    }
  }

  async function changeA4Status(nextStatus: "active" | "suspended") {
    if (!selectedBranch || !user || !admin) return;

    setLoadingAction(true);
    setErrors([]);

    try {
      const { db, rtdb } = getFirebaseServices();
      const branchRefs = Array.from(new Set([selectedBranch.id, selectedBranch.bizNum].filter(Boolean))).map((id) => doc(db, "businesses", id));
      const action = nextStatus === "suspended" ? "a4.suspend" : "a4.resume";
      const detail = nextStatus === "suspended" ? reason.trim() || "관리자 사용중단 처리" : "A4 사용중단 해제";

      if (nextStatus === "suspended") {
        await Promise.all(
          branchRefs.map((branchRef) =>
            setDoc(
              branchRef,
              {
                a4_status: "suspended",
                a4Status: "suspended",
                a4_suspended_reason: detail,
                a4_suspended_at: serverTimestamp(),
                a4_suspended_by: user.uid,
                updated_at: serverTimestamp()
              },
              { merge: true }
            )
          )
        );
      } else {
        await Promise.all(
          branchRefs.map((branchRef) =>
            setDoc(
              branchRef,
              {
                a4_status: "active",
                a4Status: "active",
                a4_resumed_at: serverTimestamp(),
                a4_resumed_by: user.uid,
                updated_at: serverTimestamp()
              },
              { merge: true }
            )
          )
        );
      }

      await setDoc(doc(collection(db, "a1_audit_logs")), {
        action,
        actorUid: user.uid,
        actorEmail: user.email || "",
        target: selectedBranch.bizNum,
        detail,
        createdAt: serverTimestamp()
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "A1 감사 로그 저장 실패";
        setErrors((current) => [...current, `감사 로그 저장 실패: ${message}`]);
      });

      await set(push(rtdbRef(rtdb, `businesses/${selectedBranch.bizNum}/signals`)), {
        type: "a4_status",
        status: nextStatus,
        message: nextStatus === "suspended" ? "사용중단 되어 있습니다. 관리자에게 문의 하세요" : "A4 사용이 재개되었습니다.",
        reason: detail,
        source: "a1",
        actorUid: user.uid,
        timestamp: Date.now()
      }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "A4 상태 변경 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setLoadingAction(false);
    }
  }

  const canWrite = Boolean(user && admin);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand">
          <div className="brand-mark">
            <ShieldCheck size={22} />
          </div>
          <div className="truncate">
            <h1 className="brand-title">A1 Developer</h1>
            <p className="brand-subtitle">Master Console</p>
          </div>
        </div>

        <nav className="side-nav" aria-label="A1 menu">
          {menu.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.key || item.children?.some((child) => child.key === activeSection);
            return (
              <div className="nav-group" key={item.key}>
                <button className={`nav-item ${active ? "active" : ""}`} onClick={() => setActiveSection(item.key)}>
                  <Icon size={17} />
                  <span>{item.label}</span>
                  <span className="nav-count">{item.count}</span>
                </button>
                {item.children?.map((child) => {
                  const ChildIcon = child.icon;
                  return (
                    <button className={`nav-subitem ${activeSection === child.key ? "active" : ""}`} key={child.key} onClick={() => setActiveSection(child.key)}>
                      <ChevronRight size={14} />
                      <ChildIcon size={15} />
                      <span>{child.label}</span>
                      <span className="nav-count">{child.count}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

      </aside>

      <div className="page">
        <header className="topbar">
          <div>
            <p className="eyebrow">A2, A3, A4, A5, B1 master control</p>
            <h2 className="page-title">{sectionTitle(activeSection)}</h2>
          </div>

          <div className="top-actions">
            <div className="user-chip" title={user ? "signed in" : "not signed in"}>
              <Lock size={15} />
              <span className="truncate">
                {!firebaseReady
                  ? "Firebase config missing"
                  : !authReady
                    ? "auth checking"
                    : user
                      ? admin
                        ? `${admin.displayName || "A1 관리자"} · ${admin.role}`
                        : "A1 권한 없음"
                      : "signed out"}
              </span>
            </div>
            {user ? (
              <button className="button" onClick={handleLogout} title="로그아웃">
                <LogOut size={16} />
                로그아웃
              </button>
            ) : (
              <button className="button primary" onClick={handleLogin} disabled={!firebaseReady} title="Google 로그인">
                <LogIn size={16} />
                로그인
              </button>
            )}
          </div>
        </header>

        <main className="main">
          {!firebaseReady && <div className="error">A1 Firebase 환경변수가 비어 있습니다. `a1/.env.local`에 Firebase Web 설정을 넣으면 콘솔이 실제 DB에 연결됩니다.</div>}

          {user && !admin && <div className="notice">현재 로그인한 Google 계정은 A1 관리 권한이 없습니다. 관리자 권한이 등록된 계정으로 다시 로그인하세요.</div>}

          {errors.slice(-3).map((error) => (
            <div className="error" key={error}>
              {error}
            </div>
          ))}

          {presencePermissionDenied && user && admin && (
            <div className="notice">
              RTDB device_presence 읽기 권한이 없어 Firestore devices 미러 기준으로 연결 상태를 표시 중입니다. Realtime Database rules를 배포하면 실시간 신호 원장으로 전환됩니다.
            </div>
          )}

          {!firebaseReady || !authReady || !user || !admin ? (
            <LoginGate firebaseReady={firebaseReady} authReady={authReady} isSignedIn={Boolean(user)} hasAdmin={Boolean(admin)} onLogin={handleLogin} onLogout={handleLogout} />
          ) : (
            <>
              {activeSection === "overview" && (
              <section className="status-strip" aria-label="A1 overview">
                <Metric label="관리 사업자" value={branches.length} icon={<Building2 size={20} />} />
                <Metric label="등록 기기" value={devices.length} icon={<Laptop size={20} />} tone="green" />
                <Metric label="온라인 기기" value={onlineDevices} icon={<Activity size={20} />} tone="blue" />
                <Metric label="A4 사용중단" value={suspendedBranches} icon={<Ban size={20} />} tone="red" />
                <Metric label="Storage 광고 영상" value={storageVideoCount} icon={<Video size={20} />} tone="purple" />
              </section>
              )}

              <section className={`content-grid ${showStoreSelector ? "" : "content-grid-full"}`}>
                {showStoreSelector && (
                <StoreSelector
                  branches={filteredBranches}
                  devices={devices}
                  selectedBizNum={selectedBranch?.bizNum || ""}
                  search={search}
                  onSearch={setSearch}
                  onSelect={(bizNum) => {
                    setSelectedBizNum(bizNum);
                    if (activeSection === "overview") setActiveSection("stores");
                  }}
                />
                )}
                <div className="content-stack">
                  {activeSection === "stores" && (
                    <QuickA4Control branch={selectedBranch} canWrite={canWrite} loadingAction={loadingAction} changeA4Status={changeA4Status} />
                  )}

                  {activeSection === "overview" && (
                    <>
                      <StoreSummary branch={selectedBranch} selectedDevices={selectedDevices} selectedAdEvents={selectedAdEvents} presenceByDeviceId={presenceByDeviceId} nowMs={nowMs} />
                      <div className="two-col">
                        <DevicesPanel devices={selectedDevices} presenceByDeviceId={presenceByDeviceId} nowMs={nowMs} compact />
                        <BroadcastPanel events={selectedAdEvents} compact />
                      </div>
                    </>
                  )}

                  {activeSection === "stores" && <StoreSummary branch={selectedBranch} selectedDevices={selectedDevices} selectedAdEvents={selectedAdEvents} presenceByDeviceId={presenceByDeviceId} nowMs={nowMs} />}

                  {activeSection === "devices" && <DevicesPanel devices={selectedDevices} presenceByDeviceId={presenceByDeviceId} nowMs={nowMs} />}

                  {activeSection === "control" && (
                    <ControlPanel
                      branch={selectedBranch}
                      canWrite={canWrite}
                      loadingAction={loadingAction}
                      accountActionLoading={accountActionLoading}
                      reason={reason}
                      setReason={setReason}
                      changeA4Status={changeA4Status}
                      changeAccountStatus={changeAccountStatus}
                      scanAccountUploads={scanSelectedAccountUploads}
                      purgeAccountUploads={purgeSelectedAccountUploads}
                      purgePreview={accountPurgePreview}
                      scanningAccountUploads={scanningAccountUploads}
                      purgingAccountUploads={purgingAccountUploads}
                      purgeConfirmText={purgeConfirmText}
                      setPurgeConfirmText={setPurgeConfirmText}
                    />
                  )}

                  {activeSection === "broadcast" && <BroadcastPanel events={selectedAdEvents} />}

                  {activeSection === "storage" && (
                    <StoragePanel
                      files={storageAdFiles}
                      loading={loadingStorage}
                      refresh={refreshStorageAdFiles}
                      adAssets={adAssets}
                      adCountsByAsset={adCountsByAsset}
                      canWrite={canWrite}
                      uploading={uploadingStorage}
                      syncingAssets={syncingAssets}
                      deletingPath={deletingStoragePath}
                      publishingPath={publishingStoragePath}
                      uploadProgress={uploadProgress}
                      selectedAdPath={selectedStorageAdPath}
                      setSelectedAdPath={setSelectedStorageAdPath}
                      placement={adPlacement}
                      setPlacement={setAdPlacement}
                      clickTarget={adClickTarget}
                      setClickTarget={setAdClickTarget}
                      playbackMode={adPlaybackMode}
                      setPlaybackMode={setAdPlaybackMode}
                      dailyLimit={adDailyLimit}
                      setDailyLimit={setAdDailyLimit}
                      scheduleStartDate={adScheduleStartDate}
                      setScheduleStartDate={setAdScheduleStartDate}
                      scheduleEndDate={adScheduleEndDate}
                      setScheduleEndDate={setAdScheduleEndDate}
                      scheduleStartTime={adScheduleStartTime}
                      setScheduleStartTime={setAdScheduleStartTime}
                      scheduleEndTime={adScheduleEndTime}
                      setScheduleEndTime={setAdScheduleEndTime}
                      savingSettingsPath={savingAdSettingsPath}
                      selectedBranch={selectedBranch}
                      selectedDevices={selectedDevices}
                      targetMode={adTargetMode}
                      setTargetMode={setAdTargetMode}
                      regionOptions={adRegionOptions}
                      selectedRegionKey={selectedAdRegionKey}
                      setSelectedRegionKey={setSelectedAdRegionKey}
                      categoryOptions={adCategoryOptions}
                      selectedCategory={selectedAdCategory}
                      setSelectedCategory={setSelectedAdCategory}
                      targetLabel={adTargetLabel}
                      targetStoreCount={adTargetBranches.length}
                      targetDeviceCount={adTargetMode === "global" ? devices.length : adTargetDevices.length}
                      uploadFile={uploadStorageAdFile}
                      publishFile={publishStorageAdFile}
                      saveSettings={saveStorageAdSettings}
                      stopFile={stopStorageAdFileBroadcast}
                      syncAssets={syncStorageAdAssets}
                      refreshRollups={refreshAdDailyRollups}
                      deleteFile={deleteStorageAdFile}
                    />
                  )}

                  {activeSection === "releases" && (
                    <ReleasePanel
                      release={a3Release}
                      apkFiles={apkFiles}
                      devices={devices}
                      canWrite={canWrite}
                      loadingFiles={loadingApks}
                      uploading={uploadingApk}
                      uploadProgress={apkUploadProgress}
                      deletingPath={deletingApkPath}
                      deployingPath={deployingApkPath}
                      versionName={apkVersionName}
                      versionCode={apkVersionCode}
                      releaseNote={apkReleaseNote}
                      forceUpdate={apkForceUpdate}
                      setVersionName={setApkVersionName}
                      setVersionCode={setApkVersionCode}
                      setReleaseNote={setApkReleaseNote}
                      setForceUpdate={setApkForceUpdate}
                      refreshFiles={refreshA3ApkFiles}
                      uploadFile={uploadA3Apk}
                      deployFile={deployA3ApkFile}
                      deleteFile={deleteA3ApkFile}
                    />
                  )}

                  {activeSection === "database" && <DatabasePanel selectedBranch={selectedBranch} />}

                  {activeSection === "audit" && <AuditPanel logs={auditLogs} />}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function sectionTitle(section: SectionKey) {
  const titles: Record<SectionKey, string> = {
    overview: "대시보드",
    stores: "매장 관제",
    devices: "연결 기기",
    control: "사용 제어",
    broadcast: "매장 광고 송출",
    storage: "Storage 광고 파일",
    releases: "A3 APK 배포",
    database: "취합 DB",
    audit: "감사 로그"
  };
  return titles[section];
}

function LoginGate({
  firebaseReady,
  authReady,
  isSignedIn,
  hasAdmin,
  onLogin,
  onLogout
}: {
  firebaseReady: boolean;
  authReady: boolean;
  isSignedIn: boolean;
  hasAdmin: boolean;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const title = !firebaseReady ? "Firebase 설정 필요" : !authReady ? "로그인 상태 확인 중" : isSignedIn && !hasAdmin ? "A1 권한 없음" : "A1 관리자 로그인";
  const description = !firebaseReady
    ? "Cloudflare Pages Production 환경변수에 Firebase Web 설정이 들어가야 Google 로그인이 활성화됩니다."
    : isSignedIn && !hasAdmin
      ? "현재 Google 계정은 A1 관리자 권한이 없습니다. 권한이 있는 계정으로 다시 로그인하세요."
      : "A1 콘솔은 승인된 Google 관리자 계정으로만 접근할 수 있습니다.";

  return (
    <section className="login-gate" aria-label="A1 login">
      <div className="login-panel">
        <div className="login-icon">
          <ShieldCheck size={30} />
        </div>
        <p className="eyebrow">A1 Developer Console</p>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="login-actions">
          {isSignedIn ? (
            <button className="button" onClick={onLogout} disabled={!firebaseReady}>
              <LogOut size={16} />
              다른 계정으로 로그인
            </button>
          ) : (
            <button className="button primary login-button" onClick={onLogin} disabled={!firebaseReady || !authReady}>
              <LogIn size={18} />
              Google로 로그인
            </button>
          )}
        </div>
        {!firebaseReady && <div className="login-help">환경변수 반영 후 Cloudflare Pages를 다시 배포해야 합니다.</div>}
      </div>
    </section>
  );
}

function StoreSelector({
  branches,
  devices,
  selectedBizNum,
  search,
  onSearch,
  onSelect
}: {
  branches: Branch[];
  devices: Device[];
  selectedBizNum: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (bizNum: string) => void;
}) {
  return (
    <div className="panel store-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Store size={17} />
          사업자 목록
        </h2>
        <button className="button icon" onClick={() => onSearch("")} title="검색 초기화">
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="panel-body">
        <div style={{ position: "relative" }}>
          <Search size={16} style={{ position: "absolute", top: 11, left: 10, color: "#667085" }} />
          <input className="input" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="사업자명, 사업자등록번호, UID 검색" style={{ paddingLeft: 34 }} />
        </div>
      </div>
      <div className="branch-list">
        {branches.length ? (
          branches.map((branch) => {
            const count = devices.filter((device) => device.bizNum === branch.bizNum || device.ownerUid === branch.ownerUid).length;
            return (
              <button className={`branch-row ${selectedBizNum === branch.bizNum ? "active" : ""}`} key={branch.bizNum} onClick={() => onSelect(branch.bizNum)}>
                <div className="truncate">
                  <p className="row-title truncate">{branch.businessName}</p>
                  <p className="row-meta truncate">사업자등록번호 {branch.bizNum}</p>
                  <p className="row-meta truncate">{branch.category} · {branch.regionKey || "권역 미분류"}</p>
                  <p className="row-meta truncate">owner {branch.ownerUid || "-"}</p>
                </div>
                <div className="pill-row">
                  <span className={`pill ${branch.status === "active" ? "green" : "amber"}`}>{branch.status}</span>
                  <span className={`pill ${branch.accountStatus === "suspended" ? "red" : "green"}`}>계정 {branch.accountStatus === "suspended" ? "정지" : "정상"}</span>
                  <span className={`pill ${branch.a4Status === "suspended" ? "red" : "green"}`}>A4 {branch.a4Status === "suspended" ? "중단" : "정상"}</span>
                  <span className="pill blue">{count} devices</span>
                </div>
              </button>
            );
          })
        ) : (
          <div className="empty">사업자 데이터가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function StoreSummary({
  branch,
  selectedDevices,
  selectedAdEvents,
  presenceByDeviceId,
  nowMs
}: {
  branch?: Branch;
  selectedDevices: Device[];
  selectedAdEvents: AdPlayEvent[];
  presenceByDeviceId: Record<string, DevicePresence>;
  nowMs: number;
}) {
  if (!branch) return <div className="empty">선택된 사업자가 없습니다.</div>;
  const onlineCount = selectedDevices.filter((device) => resolveDevicePresence(device, presenceByDeviceId[device.id], nowMs).status === "online").length;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Building2 size={17} />
          매장 관제
        </h2>
        <span className={`pill ${branch.a4Status === "suspended" ? "red" : "green"}`}>A4 {branch.a4Status === "suspended" ? "사용중단" : "사용가능"}</span>
      </div>
      <div className="panel-body">
        <div className="detail-grid">
          <Field label="사업자명" value={branch.businessName} />
          <Field label="사업자등록번호" value={branch.bizNum} />
          <Field label="매장 표시명" value={branch.storeName} />
          <Field label="대표/소유 UID" value={branch.ownerUid || "-"} />
          <Field label="카테고리" value={branch.category || "-"} />
          <Field label="권역" value={branch.regionKey || "-"} />
          <Field label="주소" value={branch.address || "-"} />
          <Field label="연결 기기" value={`${selectedDevices.length}대`} />
          <Field label="실시간 수신 기기" value={`${onlineCount}대`} />
          <Field label="매장 광고 송출 로그" value={`${selectedAdEvents.length}건`} />
          <Field label="계정 상태" value={branch.accountStatus === "suspended" ? "정지" : "정상"} />
          <Field label="A4 상태" value={branch.a4Status === "suspended" ? "사용중단" : "정상"} />
          <Field label="중단 사유" value={branch.a4SuspendedReason || "-"} />
        </div>
      </div>
    </div>
  );
}

function QuickA4Control({
  branch,
  canWrite,
  loadingAction,
  changeA4Status
}: {
  branch?: Branch;
  canWrite: boolean;
  loadingAction: boolean;
  changeA4Status: (status: "active" | "suspended") => void;
}) {
  if (!branch) return null;

  return (
    <div className="quick-control">
      <div>
        <p className="quick-title">A4 사용 제어</p>
        <p className="quick-meta">
          {branch.businessName} · {branch.bizNum}
        </p>
      </div>
      <span className={`pill ${branch.a4Status === "suspended" ? "red" : "green"}`}>{branch.a4Status === "suspended" ? "사용중단" : "사용가능"}</span>
      <div className="toolbar quick-actions">
        <button className="button danger" onClick={() => changeA4Status("suspended")} disabled={!canWrite || loadingAction || branch.a4Status === "suspended"} title="A4 사용중단">
          <Power size={16} />
          사용중단
        </button>
        <button className="button success" onClick={() => changeA4Status("active")} disabled={!canWrite || loadingAction || branch.a4Status === "active"} title="A4 사용재개">
          <Unlock size={16} />
          사용재개
        </button>
      </div>
    </div>
  );
}

function ControlPanel({
  branch,
  canWrite,
  loadingAction,
  accountActionLoading,
  reason,
  setReason,
  changeA4Status,
  changeAccountStatus,
  scanAccountUploads,
  purgeAccountUploads,
  purgePreview,
  scanningAccountUploads,
  purgingAccountUploads,
  purgeConfirmText,
  setPurgeConfirmText
}: {
  branch?: Branch;
  canWrite: boolean;
  loadingAction: boolean;
  accountActionLoading: boolean;
  reason: string;
  setReason: (value: string) => void;
  changeA4Status: (status: "active" | "suspended") => void;
  changeAccountStatus: (status: "active" | "suspended") => void;
  scanAccountUploads: () => void;
  purgeAccountUploads: () => void;
  purgePreview: AccountPurgePreview | null;
  scanningAccountUploads: boolean;
  purgingAccountUploads: boolean;
  purgeConfirmText: string;
  setPurgeConfirmText: (value: string) => void;
}) {
  if (!branch) return <div className="empty">선택된 사업자가 없습니다.</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Ban size={17} />
          사용 제어
        </h2>
        <span className={`pill ${branch.a4Status === "suspended" ? "red" : "green"}`}>{branch.a4Status === "suspended" ? "사용중단" : "사용가능"}</span>
      </div>
      <div className="panel-body two-col">
        <div className="action-box">
          <div className="detail-grid">
            <Field label="사업자명" value={branch.businessName} />
            <Field label="사업자등록번호" value={branch.bizNum} />
            <Field label="A4 상태" value={branch.a4Status === "suspended" ? "사용중단" : "정상"} />
            <Field label="마지막 중단 시간" value={branch.a4SuspendedAt} />
            <Field label="중단 관리자" value={branch.a4SuspendedBy || "-"} />
            <Field label="해제 시간" value={branch.resumedAt} />
          </div>
          <textarea className="textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="toolbar">
            <button className="button danger" onClick={() => changeA4Status("suspended")} disabled={!canWrite || loadingAction || branch.a4Status === "suspended"} title="A4 사용중단">
              <Power size={16} />
              사용중단
            </button>
            <button className="button success" onClick={() => changeA4Status("active")} disabled={!canWrite || loadingAction || branch.a4Status === "active"} title="A4 사용재개">
              <Unlock size={16} />
              사용재개
            </button>
          </div>
        </div>
        <div className="action-box">
          <div className="message-preview">
            <div>
              사용중단 되어 있습니다.
              <br />
              관리자에게 문의 하세요
            </div>
          </div>
          <div className="notice">A1은 `businesses/{branch.bizNum}`에 `a4_status: suspended`를 기록합니다. A4는 이 값을 감시해서 콘솔 진입을 차단해야 합니다.</div>
        </div>
      </div>

      <div className="panel-body account-safety">
        <div className="action-box">
          <div className="detail-grid">
            <Field label="계정 상태" value={branch.accountStatus === "suspended" ? "정지" : "정상"} />
            <Field label="owner UID" value={branch.ownerUid || "-"} />
            <Field label="계정 정지 시간" value={branch.accountSuspendedAt} />
            <Field label="계정 정지 관리자" value={branch.accountSuspendedBy || "-"} />
            <Field label="정지 사유" value={branch.accountSuspendedReason || "-"} />
            <Field label="재개 시간" value={branch.accountResumedAt} />
          </div>
          <div className="toolbar">
            <button className="button danger" onClick={() => changeAccountStatus("suspended")} disabled={!canWrite || accountActionLoading || !branch.ownerUid || branch.accountStatus === "suspended"}>
              <Lock size={16} />
              계정 정지
            </button>
            <button className="button success" onClick={() => changeAccountStatus("active")} disabled={!canWrite || accountActionLoading || !branch.ownerUid || branch.accountStatus === "active"}>
              <Unlock size={16} />
              계정 재개
            </button>
            <button className="button" onClick={scanAccountUploads} disabled={!canWrite || scanningAccountUploads || !branch.ownerUid}>
              <Search size={16} />
              {scanningAccountUploads ? "스캔 중" : "업로드 자료 스캔"}
            </button>
          </div>
          <div className="notice">계정 정지는 A1 DB와 Storage 규칙이 참조할 `account_status` 값을 남깁니다. Firebase Auth 자체 disabled 처리는 Admin SDK 함수가 연결될 때 완전 자동화할 수 있습니다.</div>
        </div>

        <div className="action-box">
          <h3 className="subsection-title">정지 계정 자료 삭제</h3>
          {purgePreview?.uid === branch.ownerUid ? (
            <>
              <div className="detail-grid">
                <Field label="스캔 시간" value={purgePreview.scannedAt} />
                <Field label="Storage 파일" value={`${purgePreview.storageFiles.length}개`} />
                <Field label="예상 용량" value={bytesText(purgePreview.totalBytes)} />
                <Field label="대상 기기" value={`${purgePreview.deviceCount}대`} />
                <Field label="playlist 참조" value={`${purgePreview.playlistRefCount}개`} />
              </div>
              <div className="purge-list">
                {purgePreview.storageFiles.slice(0, 6).map((file) => (
                  <div className="purge-row" key={file.fullPath}>
                    <span className="truncate">{file.name}</span>
                    <span>{bytesText(file.size)}</span>
                  </div>
                ))}
                {purgePreview.storageFiles.length > 6 && <div className="row-meta">외 {purgePreview.storageFiles.length - 6}개</div>}
              </div>
              <label className="scope-box">
                <span className="scope-label">삭제 확인</span>
                <input className="input" value={purgeConfirmText} onChange={(event) => setPurgeConfirmText(event.target.value)} placeholder="owner UID 또는 사업자등록번호 입력" />
              </label>
              <button className="button danger" onClick={purgeAccountUploads} disabled={!canWrite || purgingAccountUploads || !purgePreview.storageFiles.length || (purgeConfirmText !== branch.ownerUid && purgeConfirmText !== branch.bizNum)}>
                <Trash2 size={16} />
                {purgingAccountUploads ? "삭제 중" : "해당 계정 업로드 자료 삭제"}
              </button>
            </>
          ) : (
            <div className="empty">먼저 업로드 자료를 스캔하면 <code>user_uploads/{branch.ownerUid || "ownerUid"}</code> 파일과 playlist 참조를 확인합니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function DevicesPanel({
  devices,
  presenceByDeviceId,
  nowMs,
  compact = false
}: {
  devices: Device[];
  presenceByDeviceId: Record<string, DevicePresence>;
  nowMs: number;
  compact?: boolean;
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Laptop size={17} />
          연결 기기
        </h2>
        <span className="pill blue">{devices.length}</span>
      </div>
      <div className="panel-body device-grid">
        {devices.length ? (
          devices.slice(0, compact ? 6 : 40).map((device) => {
            const presence = resolveDevicePresence(device, presenceByDeviceId[device.id], nowMs);
            return (
              <div className="device-row" key={device.id}>
                <div className="truncate">
                  <p className="row-title truncate">{device.name}</p>
                  <p className="row-meta truncate">deviceId {device.id}</p>
                  <p className="row-meta truncate">last signal {presence.lastText}</p>
                </div>
                <div className="pill-row">
                  <span className={`pill ${presence.tone}`}>{presence.label}</span>
                  <span className="pill">상태 {device.status}</span>
                  <span className="pill">{device.appVersion}</span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty">연결 기기 데이터가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function BroadcastPanel({ events, compact = false }: { events: AdPlayEvent[]; compact?: boolean }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Eye size={17} />
          매장 광고 송출
        </h2>
        <span className="pill blue">{events.length}</span>
      </div>
      <div className="panel-body ad-grid">
        {events.length ? (
          events.slice(0, compact ? 6 : 60).map((event) => (
            <div className="ad-row" key={event.id}>
              <div className="truncate">
                <p className="row-title truncate">{event.adId || "unknown ad"}</p>
                <p className="row-meta truncate">device {event.deviceId || "-"}</p>
                <p className="row-meta truncate">{event.startedAt}</p>
              </div>
              <div className="pill-row">
                <span className={`pill ${event.failed ? "red" : event.completed ? "green" : "amber"}`}>{event.failed ? "실패" : event.completed ? "완료" : "재생"}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">광고 송출 로그가 아직 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function StoragePanel({
  files,
  loading,
  refresh,
  adAssets,
  adCountsByAsset,
  canWrite,
  uploading,
  syncingAssets,
  deletingPath,
  publishingPath,
  uploadProgress,
  selectedAdPath,
  setSelectedAdPath,
  placement,
  setPlacement,
  clickTarget,
  setClickTarget,
  playbackMode,
  setPlaybackMode,
  dailyLimit,
  setDailyLimit,
  scheduleStartDate,
  setScheduleStartDate,
  scheduleEndDate,
  setScheduleEndDate,
  scheduleStartTime,
  setScheduleStartTime,
  scheduleEndTime,
  setScheduleEndTime,
  savingSettingsPath,
  selectedBranch,
  selectedDevices,
  targetMode,
  setTargetMode,
  regionOptions,
  selectedRegionKey,
  setSelectedRegionKey,
  categoryOptions,
  selectedCategory,
  setSelectedCategory,
  targetLabel,
  targetStoreCount,
  targetDeviceCount,
  uploadFile,
  publishFile,
  saveSettings,
  stopFile,
  syncAssets,
  refreshRollups,
  deleteFile
}: {
  files: StorageAdFile[];
  loading: boolean;
  refresh: () => void;
  adAssets: AdAsset[];
  adCountsByAsset: Map<string, { total: number; completed: number; failed: number }>;
  canWrite: boolean;
  uploading: boolean;
  syncingAssets: boolean;
  deletingPath: string;
  publishingPath: string;
  uploadProgress: number;
  selectedAdPath: string;
  setSelectedAdPath: (path: string) => void;
  placement: AdPlacement;
  setPlacement: (placement: AdPlacement) => void;
  clickTarget: AdClickTarget;
  setClickTarget: (target: AdClickTarget) => void;
  playbackMode: AdPlaybackMode;
  setPlaybackMode: (mode: AdPlaybackMode) => void;
  dailyLimit: string;
  setDailyLimit: (value: string) => void;
  scheduleStartDate: string;
  setScheduleStartDate: (value: string) => void;
  scheduleEndDate: string;
  setScheduleEndDate: (value: string) => void;
  scheduleStartTime: string;
  setScheduleStartTime: (value: string) => void;
  scheduleEndTime: string;
  setScheduleEndTime: (value: string) => void;
  savingSettingsPath: string;
  selectedBranch?: Branch;
  selectedDevices: Device[];
  targetMode: AdTargetMode;
  setTargetMode: (mode: AdTargetMode) => void;
  regionOptions: string[];
  selectedRegionKey: string;
  setSelectedRegionKey: (value: string) => void;
  categoryOptions: string[];
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
  targetLabel: string;
  targetStoreCount: number;
  targetDeviceCount: number;
  uploadFile: (file: File | null) => void;
  publishFile: (file: StorageAdFile, scope: AdDeliveryScope) => void;
  saveSettings: (file: StorageAdFile) => void;
  stopFile: (file: StorageAdFile) => void;
  syncAssets: () => void;
  refreshRollups: () => void;
  deleteFile: (file: StorageAdFile) => void;
}) {
  const assetsById = useMemo(() => new Map(adAssets.map((asset) => [asset.id, asset])), [adAssets]);
  const policyForFile = (file: StorageAdFile) =>
    adPolicyFromSources(file.customMetadata, assetsById.get(assetIdFromStoragePath(file.fullPath)) as unknown as Record<string, unknown> | undefined);
  const selectedFile = files.find((file) => file.fullPath === selectedAdPath) || null;
  const selectedPolicy = selectedFile ? policyForFile(selectedFile) : null;
  const draftPolicy: AdPolicy = {
    placement,
    clickTarget,
    playbackMode,
    dailyLimit: playbackMode === "daily_limit" ? normalizeDailyLimit(dailyLimit) : 0,
    scheduleStartDate,
    scheduleEndDate,
    scheduleStartTime,
    scheduleEndTime
  };
  const selectedCounts = selectedFile ? adCountsByAsset.get(assetIdFromStoragePath(selectedFile.fullPath)) || { total: 0, completed: 0, failed: 0 } : null;
  const busySelected = Boolean(
    selectedFile &&
      (publishingPath === selectedFile.fullPath || savingSettingsPath === selectedFile.fullPath || deletingPath === selectedFile.fullPath)
  );

  function loadPolicy(file: StorageAdFile) {
    const policy = policyForFile(file);
    setSelectedAdPath(file.fullPath);
    setPlacement(policy.placement);
    setClickTarget(policy.clickTarget);
    setPlaybackMode(policy.playbackMode);
    setDailyLimit(String(policy.dailyLimit || 0));
    setScheduleStartDate(policy.scheduleStartDate);
    setScheduleEndDate(policy.scheduleEndDate);
    setScheduleStartTime(policy.scheduleStartTime);
    setScheduleEndTime(policy.scheduleEndTime);
  }

  return (
    <div className="content-stack">
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <HardDrive size={17} />
            Firebase Storage / ad_videos
          </h2>
          <div className="toolbar">
            <button className="button" onClick={syncAssets} disabled={!canWrite || !files.length || syncingAssets} title="Storage 파일을 ad_assets DB와 동기화">
              <Database size={16} />
              {syncingAssets ? "동기화 중" : "DB 동기화"}
            </button>
            <button className="button" onClick={refresh} disabled={loading} title="Storage 새로고침">
              <RefreshCw size={16} />
              새로고침
            </button>
          </div>
        </div>

        <div className="panel-body">
          <div className="upload-box">
            <div>
              <p className="row-title">광고 영상 업로드</p>
              <p className="row-meta">새 영상은 기본 단순 롤링 상태로 보관됩니다. 아래 목록에서 선택한 뒤 옵션을 저장하거나 송출하세요.</p>
            </div>
            <label className={`button primary ${!canWrite || uploading ? "disabled-like" : ""}`}>
              <Upload size={16} />
              {uploading ? `업로드 ${uploadProgress}%` : "파일 선택"}
              <input
                type="file"
                accept="video/*,.mp4,.mov,.webm"
                disabled={!canWrite || uploading}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  event.currentTarget.value = "";
                  uploadFile(file);
                }}
              />
            </label>
          </div>
          {uploading && (
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>

        <div className="panel-body ad-workbench">
          <section className="ad-step-pane">
            <div className="step-header">
              <span className="step-number">1</span>
              <div>
                <h3>광고 선택</h3>
                <p>{files.length}개 파일</p>
              </div>
            </div>
            <div className="ad-select-list">
              {files.length ? (
                files.map((file) => {
                  const policy = policyForFile(file);
                  const selected = selectedFile?.fullPath === file.fullPath;
                  return (
                    <button className={`ad-select-row ${selected ? "active" : ""}`} key={file.id} type="button" onClick={() => loadPolicy(file)}>
                      <span className="row-title truncate">{file.name}</span>
                      <span className="row-meta truncate">{file.contentType} · {bytesText(file.size)}</span>
                      <span className="row-meta truncate">{adScheduleSummary(policy)}</span>
                    </button>
                  );
                })
              ) : (
                <div className="empty">Firebase Storage의 `ad_videos/` 폴더에 표시할 영상이 없습니다.</div>
              )}
            </div>
          </section>

          <section className="ad-step-pane">
            <div className="step-header">
              <span className="step-number">2</span>
              <div>
                <h3>옵션 설정</h3>
                <p>{selectedFile ? selectedFile.name : "선택된 광고 없음"}</p>
              </div>
            </div>

            {selectedFile ? (
              <div className="settings-stack">
                <div className="selected-ad-summary">
                  <div className="truncate">
                    <p className="row-title truncate">{selectedFile.name}</p>
                    <p className="row-meta truncate">{selectedFile.fullPath}</p>
                    <p className="row-meta truncate">저장값: {selectedPolicy ? adScheduleSummary(selectedPolicy) : "-"}</p>
                  </div>
                  {selectedFile.url && (
                    <a className="button" href={selectedFile.url} target="_blank" rel="noreferrer">
                      열기
                    </a>
                  )}
                </div>

                <div className="scope-options">
                  <div className="scope-box">
                    <p className="scope-label">광고 구역</p>
                    <div className="segmented" aria-label="A3 ad placement">
                      <button type="button" className={placement === "normal" ? "active" : ""} onClick={() => setPlacement("normal")}>
                        기본 광고
                      </button>
                      <button type="button" className={placement === "portrait_fullscreen" ? "active" : ""} onClick={() => setPlacement("portrait_fullscreen")}>
                        세로 전면
                      </button>
                    </div>
                  </div>
                  <div className="scope-box">
                    <p className="scope-label">클릭 이동</p>
                    <div className="segmented" aria-label="A3 ad click target">
                      <button type="button" className={clickTarget === "hotdeal" ? "active" : ""} onClick={() => setClickTarget("hotdeal")}>
                        핫딜
                      </button>
                      <button type="button" className={clickTarget === "luxury" ? "active" : ""} onClick={() => setClickTarget("luxury")}>
                        명품관
                      </button>
                    </div>
                  </div>
                </div>

                <div className="scope-box">
                  <p className="scope-label">송출 방식</p>
                  <div className="segmented" aria-label="A3 ad playback mode">
                    <button type="button" className={playbackMode === "rolling" ? "active" : ""} onClick={() => setPlaybackMode("rolling")}>
                      단순 롤링
                    </button>
                    <button type="button" className={playbackMode === "daily_limit" ? "active" : ""} onClick={() => setPlaybackMode("daily_limit")}>
                      하루 횟수 제한
                    </button>
                  </div>
                </div>

                <div className="form-grid compact-form">
                  <label>
                    <span>기기당 하루 송출 횟수</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      value={dailyLimit}
                      onChange={(event) => setDailyLimit(event.target.value)}
                      disabled={playbackMode === "rolling"}
                      placeholder="0"
                    />
                  </label>
                  <label>
                    <span>시작 일자</span>
                    <input className="input" type="date" value={scheduleStartDate} onChange={(event) => setScheduleStartDate(event.target.value)} />
                  </label>
                  <label>
                    <span>종료 일자</span>
                    <input className="input" type="date" value={scheduleEndDate} onChange={(event) => setScheduleEndDate(event.target.value)} />
                  </label>
                  <label>
                    <span>시작 시간</span>
                    <input className="input" type="time" value={scheduleStartTime} onChange={(event) => setScheduleStartTime(event.target.value)} />
                  </label>
                  <label>
                    <span>종료 시간</span>
                    <input className="input" type="time" value={scheduleEndTime} onChange={(event) => setScheduleEndTime(event.target.value)} />
                  </label>
                </div>

                <div className="policy-preview">
                  <p className="field-label">적용 예정</p>
                  <p className="field-value">{adPlacementLabel(placement)} / {adClickTargetLabel(clickTarget)} / {adScheduleSummary(draftPolicy)}</p>
                </div>
              </div>
            ) : (
              <div className="empty">옵션을 수정할 광고를 먼저 선택하세요.</div>
            )}
          </section>

          <section className="ad-step-pane">
            <div className="step-header">
              <span className="step-number">3</span>
              <div>
                <h3>송출 대상</h3>
                <p>{targetLabel} · 매장 {targetStoreCount}개 · A3 {targetDeviceCount}대</p>
              </div>
            </div>

            <div className="settings-stack">
              <div className="scope-box">
                <p className="scope-label">대상 방식</p>
                <div className="segmented segmented-wrap" aria-label="Ad target mode">
                  <button type="button" className={targetMode === "global" ? "active" : ""} onClick={() => setTargetMode("global")}>
                    전체
                  </button>
                  <button type="button" className={targetMode === "region" ? "active" : ""} onClick={() => setTargetMode("region")}>
                    권역
                  </button>
                  <button type="button" className={targetMode === "category" ? "active" : ""} onClick={() => setTargetMode("category")}>
                    카테고리
                  </button>
                  <button type="button" className={targetMode === "segment" ? "active" : ""} onClick={() => setTargetMode("segment")}>
                    권역+카테고리
                  </button>
                  <button type="button" className={targetMode === "store" ? "active" : ""} onClick={() => setTargetMode("store")}>
                    선택 매장
                  </button>
                </div>
              </div>

              {(targetMode === "region" || targetMode === "segment") && (
                <label className="scope-box">
                  <span className="scope-label">권역</span>
                  <select className="input" value={selectedRegionKey} onChange={(event) => setSelectedRegionKey(event.target.value)}>
                    {regionOptions.map((region) => (
                      <option value={region} key={region}>
                        {region}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {(targetMode === "category" || targetMode === "segment") && (
                <label className="scope-box">
                  <span className="scope-label">매장 카테고리</span>
                  <select className="input" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
                    {categoryOptions.map((category) => (
                      <option value={category} key={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {targetMode === "store" && (
                <div className="policy-preview">
                  <p className="field-label">선택 매장</p>
                  <p className="field-value">{selectedBranch?.businessName || selectedBranch?.bizNum || "-"}</p>
                </div>
              )}

              <div className="policy-preview">
                <p className="field-label">적용 대상</p>
                <p className="field-value">{targetLabel} / 매장 {targetStoreCount}개 / A3 {targetDeviceCount}대</p>
              </div>
            </div>
          </section>

          <section className="ad-step-pane">
            <div className="step-header">
              <span className="step-number">4</span>
              <div>
                <h3>적용</h3>
                <p>{targetLabel} · A3 {targetDeviceCount}대</p>
              </div>
            </div>

            {selectedFile ? (
              <div className="apply-stack">
                <button className="button primary" onClick={() => saveSettings(selectedFile)} disabled={!canWrite || busySelected || !selectedFile.url}>
                  <Settings size={16} />
                  {savingSettingsPath === selectedFile.fullPath ? "저장 중" : "설정만 저장"}
                </button>
                <button className="button success" onClick={() => publishFile(selectedFile, targetMode)} disabled={!canWrite || busySelected || !selectedFile.url || (targetMode !== "global" && !targetDeviceCount)}>
                  <Upload size={16} />
                  대상에 송출
                </button>
                <button className="button" onClick={() => stopFile(selectedFile)} disabled={!canWrite || busySelected}>
                  <Ban size={16} />
                  송출 중지
                </button>
                <button className="button danger" onClick={() => deleteFile(selectedFile)} disabled={!canWrite || busySelected}>
                  <Trash2 size={16} />
                  {deletingPath === selectedFile.fullPath ? "삭제 중" : "파일 삭제"}
                </button>
                <div className="policy-preview">
                  <p className="field-label">전일까지 집계</p>
                  <p className="field-value">{selectedCounts?.total || 0}회 / 완료 {selectedCounts?.completed || 0} / 실패 {selectedCounts?.failed || 0}</p>
                </div>
              </div>
            ) : (
              <div className="empty">적용할 광고가 없습니다.</div>
            )}
          </section>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <FileVideo size={17} />
            광고 파일 송출 집계
          </h2>
          <div className="toolbar">
            <button className="button" onClick={refreshRollups} title="Refresh daily ad rollups">
              <RefreshCw size={16} />
              집계 갱신
            </button>
            <span className="pill blue">{adAssets.length} assets</span>
          </div>
        </div>
        <div className="panel-body ad-grid">
          {adAssets.length ? (
            adAssets.slice(0, 20).map((asset) => {
              const counts = adCountsByAsset.get(asset.id) || { total: 0, completed: 0, failed: 0 };
              return (
                <div className="ad-row" key={asset.id}>
                  <div className="truncate">
                    <p className="row-title truncate">{asset.title}</p>
                    <p className="row-meta truncate">
                      {asset.advertiser} · {asset.fileName}
                    </p>
                  </div>
                  <div className="pill-row">
                    <span className="pill blue">{counts.total}회</span>
                    <span className="pill green">{counts.completed}완료</span>
                    <span className="pill red">{counts.failed}실패</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty">`ad_assets` 컬렉션이 비어 있습니다. Storage 파일과 송출 통계를 묶으려면 영상별 ad id가 필요합니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReleasePanel({
  release,
  apkFiles,
  devices,
  canWrite,
  loadingFiles,
  uploading,
  uploadProgress,
  deletingPath,
  deployingPath,
  versionName,
  versionCode,
  releaseNote,
  forceUpdate,
  setVersionName,
  setVersionCode,
  setReleaseNote,
  setForceUpdate,
  refreshFiles,
  uploadFile,
  deployFile,
  deleteFile
}: {
  release?: AppRelease;
  apkFiles: StorageAdFile[];
  devices: Device[];
  canWrite: boolean;
  loadingFiles: boolean;
  uploading: boolean;
  uploadProgress: number;
  deletingPath: string;
  deployingPath: string;
  versionName: string;
  versionCode: string;
  releaseNote: string;
  forceUpdate: boolean;
  setVersionName: (value: string) => void;
  setVersionCode: (value: string) => void;
  setReleaseNote: (value: string) => void;
  setForceUpdate: (value: boolean) => void;
  refreshFiles: () => void;
  uploadFile: (file: File | null) => void;
  deployFile: (file: StorageAdFile) => void;
  deleteFile: (file: StorageAdFile) => void;
}) {
  const a3Devices = devices.filter((device) => {
    const raw = device.raw || {};
    const source = text(raw.presenceSource || raw.source || raw.appId || raw.app_id).toLowerCase();
    return source === "a3" || device.platform.toLowerCase().includes("a3") || device.appVersion !== "-";
  });
  const behindCount = release
    ? a3Devices.filter((device) => {
        const raw = device.raw || {};
        const currentCode = numberValue(raw.appVersionCode || raw.app_version_code || raw.buildNumber || raw.build_number);
        return currentCode > 0 && currentCode < release.versionCode;
      }).length
    : 0;

  return (
    <div className="content-stack">
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <Upload size={17} />
            A3 APK 배포
          </h2>
          {release && <span className="pill blue">최신 {release.versionName}+{release.versionCode}</span>}
        </div>
        <div className="panel-body">
          <div className="upload-box">
            <div>
              <p className="row-title">A3 APK 업로드</p>
              <p className="row-meta">Firebase Storage `app_releases/a3/`에 먼저 저장합니다. 실제 A3 최신 배포는 파일 목록의 `배포` 버튼으로 확정합니다.</p>
            </div>
            <label className={`button primary ${!canWrite || uploading ? "disabled-like" : ""}`}>
              <Upload size={16} />
              {uploading ? `업로드 ${uploadProgress}%` : "APK 선택"}
              <input
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                disabled={!canWrite || uploading}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  event.currentTarget.value = "";
                  uploadFile(file);
                }}
              />
            </label>
          </div>
          {uploading && (
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
          <div className="form-grid">
            <label className="field">
              <span>버전명</span>
              <input className="input" value={versionName} onChange={(event) => setVersionName(event.target.value)} placeholder="예: 1.0.1" />
            </label>
            <label className="field">
              <span>versionCode</span>
              <input className="input" value={versionCode} onChange={(event) => setVersionCode(event.target.value.replace(/\D/g, ""))} placeholder="예: 21" />
            </label>
            <label className="field wide">
              <span>릴리즈 노트</span>
              <input className="input" value={releaseNote} onChange={(event) => setReleaseNote(event.target.value)} placeholder="변경 내용을 입력하세요" />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={true} readOnly disabled />
              배포 시 A3 강제 업데이트 팝업 표시
            </label>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <HardDrive size={17} />
            Firebase Storage / app_releases/a3
          </h2>
          <button className="button" onClick={refreshFiles} disabled={loadingFiles} title="A3 APK Storage 새로고침">
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>
        <div className="panel-body ad-grid">
          {apkFiles.length ? (
            apkFiles.map((file) => (
              <div className="ad-row" key={file.id}>
                <div className="truncate">
                  <p className="row-title truncate">{file.name}</p>
                  <p className="row-meta truncate">{file.fullPath}</p>
                  <p className="row-meta truncate">
                    {file.contentType} · {bytesText(file.size)} · {file.updated}
                  </p>
                </div>
                <div className="pill-row">
                  <span className={`pill ${release?.storagePath === file.fullPath ? "green" : "blue"}`}>{release?.storagePath === file.fullPath ? "최신" : "APK"}</span>
                  {file.url && (
                    <a className="button" href={file.url} target="_blank" rel="noreferrer">
                      다운로드
                    </a>
                  )}
                  <button className="button success" onClick={() => deployFile(file)} disabled={!canWrite || deployingPath === file.fullPath || !file.url} title="이 APK를 A3 최신 배포로 확정">
                    <Upload size={16} />
                    {deployingPath === file.fullPath ? "배포 중" : "배포"}
                  </button>
                  <button className="button danger" onClick={() => deleteFile(file)} disabled={!canWrite || deletingPath === file.fullPath} title="A3 APK Storage 파일 삭제">
                    <Trash2 size={16} />
                    {deletingPath === file.fullPath ? "삭제 중" : "삭제"}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">Firebase Storage의 `app_releases/a3/` 폴더에 표시할 APK가 없습니다.</div>
          )}
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <HardDrive size={17} />
              최신 릴리즈
            </h2>
          </div>
          <div className="panel-body">
            {release ? (
              <div className="db-grid">
                <DbItem name="version" value={`${release.versionName}+${release.versionCode}`} />
                <DbItem name="file" value={`${release.fileName} · ${bytesText(release.size)}`} />
                <DbItem name="storagePath" value={release.storagePath || "-"} />
                <DbItem name="forceUpdate" value={release.forceUpdate ? "true" : "false"} />
                <DbItem name="updatedAt" value={release.updatedAt || "-"} />
                {release.apkUrl && (
                  <a className="button" href={release.apkUrl} target="_blank" rel="noreferrer">
                    APK 다운로드 확인
                  </a>
                )}
              </div>
            ) : (
              <div className="empty">등록된 A3 APK 릴리즈가 없습니다.</div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <Laptop size={17} />
              A3 업데이트 현황
            </h2>
            <span className="pill amber">{behindCount}대 업데이트 필요</span>
          </div>
          <div className="panel-body ad-grid">
            {a3Devices.length ? (
              a3Devices.slice(0, 20).map((device) => {
                const raw = device.raw || {};
                const code = numberValue(raw.appVersionCode || raw.app_version_code || raw.buildNumber || raw.build_number);
                const status = text(raw.updateStatus || raw.update_status, "idle");
                return (
                  <div className="ad-row" key={device.id}>
                    <div className="truncate">
                      <p className="row-title truncate">{device.name}</p>
                      <p className="row-meta truncate">{device.id}</p>
                      <p className="row-meta truncate">현재 {device.appVersion} {code ? `+${code}` : ""}</p>
                    </div>
                    <div className="pill-row">
                      <span className={`pill ${release && code > 0 && code < release.versionCode ? "amber" : "green"}`}>
                        {release && code > 0 && code < release.versionCode ? "대상" : "정상"}
                      </span>
                      <span className="pill">{status}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="empty">A3 기기 버전 정보가 아직 없습니다. A3 업데이트 클라이언트가 버전을 보고하면 표시됩니다.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DatabasePanel({ selectedBranch }: { selectedBranch?: Branch }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Database size={17} />
          취합 DB
        </h2>
      </div>
      <div className="panel-body db-grid">
        <DbItem name="businesses/{bizNum}" value={`사업자/매장 기본 정보, A4 상태, 권한. 현재 선택: ${selectedBranch?.bizNum || "-"}`} />
        <DbItem name="devices/{deviceId}" value="A3 플레이어 기기, 객실/모니터, 앱 버전, 하트비트 Firestore 미러" />
        <DbItem name="device_presence/{deviceId}" value="A3 실시간 생존 신호 원장: connected, lastHeartbeatAtMs, lastDisconnectedAtMs, sessionId" />
        <DbItem name="businesses/{bizNum}/device_presence/{deviceId}" value="매장 단위 실시간 기기 신호 복사본" />
        <DbItem name="Firebase Storage/ad_videos" value="실제 광고 영상 파일 위치" />
        <DbItem name="ad_assets" value="광고 파일 메타데이터: 제목, 광고주, Storage 경로, 활성 상태" />
        <DbItem name="Firebase Storage/app_releases/a3" value="A3 APK 실제 파일 위치. A1에서 업로드와 삭제를 수행" />
        <DbItem name="app_releases/a3" value="A3 최신 APK 배포 문서: version, apkUrl, storagePath, forceUpdate" />
        <DbItem name="app_release_files" value="APK 파일별 메타데이터와 삭제 상태 기록" />
        <DbItem name="ad_campaigns" value="광고 편성: 대상 사업자, 기간, 우선순위" />
        <DbItem name="ad_play_events" value="영상 1회 송출 원장 로그: 어느 매장/기기에서 몇 회 재생됐는지 집계" />
        <DbItem name="a1_audit_logs" value="A1 관리자 조작 감사 로그" />
      </div>
    </div>
  );
}

function AuditPanel({ logs }: { logs: AuditLog[] }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <AlertTriangle size={17} />
          A1 감사 로그
        </h2>
      </div>
      <div className="panel-body audit-list">
        {logs.length ? (
          logs.map((log) => (
            <div className="audit-row" key={log.id}>
              <div className="strong">{log.action}</div>
              <div className="small">
                {log.target} · {log.createdAt}
              </div>
              <div className="small">{log.detail}</div>
            </div>
          ))
        ) : (
          <div className="empty">감사 로그가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  tone = "default"
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "green" | "amber" | "red" | "purple" | "blue";
}) {
  return (
    <div className="metric">
      <div>
        <p className="metric-label">{label}</p>
        <p className="metric-value">{value.toLocaleString("ko-KR")}</p>
      </div>
      <div className={`metric-icon ${tone === "blue" ? "" : tone}`}>{icon}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <p className="field-label">{label}</p>
      <p className="field-value">{value || "-"}</p>
    </div>
  );
}

function DbItem({ name, value }: { name: string; value: string }) {
  return (
    <div className="db-item">
      <div className="strong">{name}</div>
      <div className="small">{value}</div>
    </div>
  );
}
