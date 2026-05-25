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
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference
} from "firebase/firestore";
import { onValue, push, ref as rtdbRef, set } from "firebase/database";
import { deleteObject, getDownloadURL, getMetadata, listAll, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { getFirebaseServices, hasFirebaseConfig } from "@/lib/firebase";
import type { AdAsset, AdPlayEvent, AdminProfile, AppRelease, AuditLog, Branch, Device, DevicePresence, StorageAdFile } from "@/types";

const MASTER_EMAIL_HASH = "a4f828fbd0b0d2fb38524e2c80f88357b40ea9e06bdb0604f23278af8049ee1d";

type SectionKey = "overview" | "stores" | "devices" | "control" | "broadcast" | "storage" | "releases" | "database" | "audit";
type AdDeliveryScope = "store" | "global";

function text(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function adEntryMatchesFile(entry: unknown, file: Pick<StorageAdFile, "url" | "fullPath">) {
  const assetId = assetIdFromStoragePath(file.fullPath);
  if (typeof entry === "string") return Boolean(file.url) && entry === file.url;
  if (entry && typeof entry === "object") {
    const row = entry as Record<string, unknown>;
    return (
      text(row.url || row.downloadUrl || row.storageUrl) === file.url ||
      text(row.storagePath || row.storage_path || row.fullPath) === file.fullPath ||
      text(row.assetId || row.asset_id || row.adId || row.id) === assetId
    );
  }
  return false;
}

function adUrlsFromList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(adUrlFromEntry).filter(Boolean)));
}

function normalizeBranch(id: string, data: Record<string, unknown>): Branch {
  const a4Status = text(data.a4_status || data.a4Status, "active") === "suspended" ? "suspended" : "active";
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

  return {
    id,
    bizNum,
    businessName,
    storeName: text(data.store_name || data.storeName || data.shopName || data.name || data.businessName || data.business_name, businessName),
    ownerUid: text(data.ownerUid || data.owner_uid),
    status: text(data.status, "active"),
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
    url: text(data.url || data.downloadUrl || data.storageUrl)
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
  const mirroredHeartbeatMs = numberValue(device.raw.lastHeartbeatAtMs);
  const heartbeatMs = presence?.lastHeartbeatAtMs || mirroredHeartbeatMs;
  const ageMs = heartbeatMs ? nowMs - heartbeatMs : Number.POSITIVE_INFINITY;

  if (presence?.connected === true && ageMs <= ONLINE_WINDOW_MS) {
    return { status: "online", label: "신호 수신", tone: "green", lastText: agoText(ageMs) };
  }

  if (presence?.connected === false) {
    const disconnectedMs = presence.lastDisconnectedAtMs || heartbeatMs;
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [adAssets, setAdAssets] = useState<AdAsset[]>([]);
  const [storageAdFiles, setStorageAdFiles] = useState<StorageAdFile[]>([]);
  const [apkFiles, setApkFiles] = useState<StorageAdFile[]>([]);
  const [appReleases, setAppReleases] = useState<AppRelease[]>([]);
  const [adEvents, setAdEvents] = useState<AdPlayEvent[]>([]);
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
  const [adDeliveryScope, setAdDeliveryScope] = useState<AdDeliveryScope>("store");
  const [publishingStoragePath, setPublishingStoragePath] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [apkUploadProgress, setApkUploadProgress] = useState(0);
  const [apkVersionName, setApkVersionName] = useState("");
  const [apkVersionCode, setApkVersionCode] = useState("");
  const [apkReleaseNote, setApkReleaseNote] = useState("");
  const [apkForceUpdate, setApkForceUpdate] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const firebaseReady = hasFirebaseConfig();

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
      (error) => setErrors((current) => [...current, `device_presence 조회 실패: ${error.message}`])
    );

    return () => unsubscribe();
  }, [firebaseReady, user, admin]);

  useEffect(() => {
    if (!firebaseReady || !user || !admin) return;
    refreshStorageAdFiles();
    refreshA3ApkFiles();
  }, [firebaseReady, user, admin]);

  const branchByBizNum = useMemo(() => new Map(branches.map((branch) => [branch.bizNum, branch])), [branches]);
  const selectedBranch = branchByBizNum.get(selectedBizNum) || branches[0];

  const filteredBranches = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return branches;
    return branches.filter((branch) => {
      return `${branch.bizNum} ${branch.businessName} ${branch.storeName} ${branch.ownerUid} ${branch.status} ${branch.a4Status}`.toLowerCase().includes(keyword);
    });
  }, [branches, search]);

  const selectedDevices = useMemo(() => {
    if (!selectedBranch) return [];
    return devices.filter((device) => device.bizNum === selectedBranch.bizNum || device.ownerUid === selectedBranch.ownerUid);
  }, [devices, selectedBranch]);

  const selectedAdEvents = useMemo(() => {
    if (!selectedBranch) return [];
    return adEvents.filter((event) => event.bizNum === selectedBranch.bizNum);
  }, [adEvents, selectedBranch]);

  const adCountsByAsset = useMemo(() => {
    const map = new Map<string, { total: number; completed: number; failed: number }>();
    adEvents.forEach((event) => {
      const key = event.adId || "unknown";
      const current = map.get(key) || { total: 0, completed: 0, failed: 0 };
      current.total += 1;
      if (event.completed) current.completed += 1;
      if (event.failed) current.failed += 1;
      map.set(key, current);
    });
    return map;
  }, [adEvents]);

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
            url
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
            url
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
      const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
      const storagePath = `ad_videos/${Date.now()}_${safeName}`;
      const fileRef = storageRef(storage, storagePath);
      const uploadTask = uploadBytesResumable(fileRef, file, {
        contentType: file.type || "video/mp4",
        customMetadata: {
          source: "a1",
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

      await publishStorageAdFile(
        {
          id: storagePath,
          name: file.name,
          fullPath: storagePath,
          bucket: "",
          contentType: file.type || "video/mp4",
          size: file.size,
          updated: new Date().toLocaleString("ko-KR"),
          url
        },
        adDeliveryScope
      );

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
        forceUpdate: apkForceUpdate,
        releaseNote: apkReleaseNote.trim(),
        status: "active",
        storageDeleted: false,
        uploadedBy: user.email || user.uid,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      };

      await setDoc(doc(db, "app_releases", "a3"), releaseData, { merge: true });
      await setDoc(doc(db, "app_release_files", releaseFileId), {
        ...releaseData,
        latest: true,
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

  async function addAdUrlToA3Document(targetRef: DocumentReference, url: string) {
    const snapshot = await getDoc(targetRef).catch(() => null);
    const data = snapshot?.exists() ? snapshot.data() : {};
    const urls = adUrlsFromList((data as Record<string, unknown>).ad_videos);

    if (!urls.includes(url)) urls.push(url);

    await setDoc(
      targetRef,
      {
        ad_videos: urls,
        source: "a1",
        updatedBy: user?.uid || "a1",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  async function removeAdFileFromA3Document(targetRef: DocumentReference, file: StorageAdFile) {
    const snapshot = await getDoc(targetRef).catch(() => null);
    if (!snapshot?.exists()) return;

    const data = snapshot.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.ad_videos) ? data.ad_videos : [];
    if (!rawList.length) return;

    const remainingUrls = Array.from(
      new Set(
        rawList
          .filter((entry) => !adEntryMatchesFile(entry, file))
          .map(adUrlFromEntry)
          .filter(Boolean)
      )
    );

    await setDoc(
      targetRef,
      {
        ad_videos: remainingUrls,
        source: "a1",
        updatedBy: user?.uid || "a1",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  async function publishStorageAdFile(file: StorageAdFile, scope: AdDeliveryScope = adDeliveryScope) {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;
    if (!file.url) {
      setErrors((current) => [...current, `${file.name}: Storage download URL이 없어 A3 송출 목록에 반영하지 못했습니다.`]);
      return;
    }

    const targetDevices = scope === "store" ? selectedDevices : [];
    if (scope === "store" && !targetDevices.length) {
      setErrors((current) => [...current, "선택 매장에 연결된 A3 기기가 없어 광고 URL을 반영하지 못했습니다."]);
      return;
    }

    setPublishingStoragePath(file.fullPath);
    setErrors([]);

    try {
      const { db } = getFirebaseServices();
      const assetId = assetIdFromStoragePath(file.fullPath);

      if (scope === "global") {
        await addAdUrlToA3Document(doc(db, "global_campaigns", "current_ads"), file.url);
      } else {
        await Promise.all(targetDevices.map((device) => addAdUrlToA3Document(doc(db, "devices", device.id), file.url)));
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
          publishedTargetBizNum: scope === "store" ? selectedBranch?.bizNum || "" : "*",
          publishedTargetName: scope === "store" ? selectedBranch?.businessName || "" : "all",
          publishedDeviceCount: scope === "store" ? targetDevices.length : devices.length,
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
        detail: `${file.name} -> ${scope === "global" ? "전체 A3" : `${selectedBranch?.businessName || selectedBranch?.bizNum || "-"} / ${targetDevices.length}대`}`,
        createdAt: serverTimestamp()
      }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "A3 광고 송출 목록 반영 실패";
      setErrors((current) => [...current, message]);
    } finally {
      setPublishingStoragePath("");
    }
  }

  async function removeStorageAdFileFromA3(file: StorageAdFile) {
    if (!firebaseReady || !user || !admin || !file.fullPath) return;

    const { db } = getFirebaseServices();
    await removeAdFileFromA3Document(doc(db, "global_campaigns", "current_ads"), file).catch((error) => {
      const message = error instanceof Error ? error.message : "global ad_videos remove failed";
      setErrors((current) => [...current, `global_campaigns/current_ads 삭제 반영 실패: ${message}`]);
    });

    await Promise.all(
      devices.map((device) =>
        removeAdFileFromA3Document(doc(db, "devices", device.id), file).catch((error) => {
          const message = error instanceof Error ? error.message : "device ad_videos remove failed";
          setErrors((current) => [...current, `devices/${device.id} 삭제 반영 실패: ${message}`]);
        })
      )
    );
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

      await removeStorageAdFileFromA3(file);

      await deleteObject(storageRef(storage, file.fullPath)).catch((error) => {
        if (!isStorageObjectNotFound(error)) throw error;
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
      const branchRef = doc(db, "businesses", selectedBranch.bizNum);
      const action = nextStatus === "suspended" ? "a4.suspend" : "a4.resume";
      const detail = nextStatus === "suspended" ? reason.trim() || "관리자 사용중단 처리" : "A4 사용중단 해제";

      if (nextStatus === "suspended") {
        await updateDoc(branchRef, {
          a4_status: "suspended",
          a4Status: "suspended",
          a4_suspended_reason: detail,
          a4_suspended_at: serverTimestamp(),
          a4_suspended_by: user.uid,
          updated_at: serverTimestamp()
        });
      } else {
        await updateDoc(branchRef, {
          a4_status: "active",
          a4Status: "active",
          a4_resumed_at: serverTimestamp(),
          a4_resumed_by: user.uid,
          updated_at: serverTimestamp()
        });
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

          {!firebaseReady || !authReady || !user || !admin ? (
            <LoginGate firebaseReady={firebaseReady} authReady={authReady} isSignedIn={Boolean(user)} hasAdmin={Boolean(admin)} onLogin={handleLogin} onLogout={handleLogout} />
          ) : (
            <>
              <section className="status-strip" aria-label="A1 overview">
                <Metric label="관리 사업자" value={branches.length} icon={<Building2 size={20} />} />
                <Metric label="등록 기기" value={devices.length} icon={<Laptop size={20} />} tone="green" />
                <Metric label="온라인 기기" value={onlineDevices} icon={<Activity size={20} />} tone="blue" />
                <Metric label="A4 사용중단" value={suspendedBranches} icon={<Ban size={20} />} tone="red" />
                <Metric label="Storage 광고 영상" value={storageVideoCount} icon={<Video size={20} />} tone="purple" />
              </section>

              <section className="content-grid">
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
                <div className="content-stack">
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
                    <ControlPanel branch={selectedBranch} canWrite={canWrite} loadingAction={loadingAction} reason={reason} setReason={setReason} changeA4Status={changeA4Status} />
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
                      deliveryScope={adDeliveryScope}
                      setDeliveryScope={setAdDeliveryScope}
                      selectedBranch={selectedBranch}
                      selectedDevices={selectedDevices}
                      uploadFile={uploadStorageAdFile}
                      publishFile={publishStorageAdFile}
                      syncAssets={syncStorageAdAssets}
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
                  <p className="row-meta truncate">owner {branch.ownerUid || "-"}</p>
                </div>
                <div className="pill-row">
                  <span className={`pill ${branch.status === "active" ? "green" : "amber"}`}>{branch.status}</span>
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
          <Field label="연결 기기" value={`${selectedDevices.length}대`} />
          <Field label="실시간 수신 기기" value={`${onlineCount}대`} />
          <Field label="매장 광고 송출 로그" value={`${selectedAdEvents.length}건`} />
          <Field label="A4 상태" value={branch.a4Status === "suspended" ? "사용중단" : "정상"} />
          <Field label="중단 사유" value={branch.a4SuspendedReason || "-"} />
        </div>
      </div>
    </div>
  );
}

function ControlPanel({
  branch,
  canWrite,
  loadingAction,
  reason,
  setReason,
  changeA4Status
}: {
  branch?: Branch;
  canWrite: boolean;
  loadingAction: boolean;
  reason: string;
  setReason: (value: string) => void;
  changeA4Status: (status: "active" | "suspended") => void;
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
  deliveryScope,
  setDeliveryScope,
  selectedBranch,
  selectedDevices,
  uploadFile,
  publishFile,
  syncAssets,
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
  deliveryScope: AdDeliveryScope;
  setDeliveryScope: (scope: AdDeliveryScope) => void;
  selectedBranch?: Branch;
  selectedDevices: Device[];
  uploadFile: (file: File | null) => void;
  publishFile: (file: StorageAdFile) => void;
  syncAssets: () => void;
  deleteFile: (file: StorageAdFile) => void;
}) {
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
              <p className="row-meta">Firebase Storage `ad_videos/`에 저장하고 A3가 읽는 `ad_videos` URL 목록까지 반영합니다.</p>
              <div className="scope-box">
                <div className="segmented" aria-label="A3 ad delivery target">
                  <button type="button" className={deliveryScope === "store" ? "active" : ""} onClick={() => setDeliveryScope("store")}>
                    선택 매장
                  </button>
                  <button type="button" className={deliveryScope === "global" ? "active" : ""} onClick={() => setDeliveryScope("global")}>
                    전체
                  </button>
                </div>
                <p className="scope-summary">
                  {deliveryScope === "global"
                    ? "A3 전체 공통 경로(global_campaigns/current_ads.ad_videos)에 URL을 반영합니다."
                    : `${selectedBranch?.businessName || selectedBranch?.bizNum || "선택 매장"} · 연결 A3 ${selectedDevices.length}대`}
                </p>
              </div>
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
        <div className="panel-body ad-grid">
          {files.length ? (
            files.map((file) => (
              <div className="ad-row" key={file.id}>
                <div className="truncate">
                  <p className="row-title truncate">{file.name}</p>
                  <p className="row-meta truncate">{file.fullPath}</p>
                  <p className="row-meta truncate">
                    {file.contentType} · {bytesText(file.size)} · {file.updated}
                  </p>
                </div>
                <div className="pill-row">
                  <span className="pill blue">Storage</span>
                  {file.url && (
                    <a className="button" href={file.url} target="_blank" rel="noreferrer">
                      열기
                    </a>
                  )}
                  <button className="button success" onClick={() => publishFile(file)} disabled={!canWrite || publishingPath === file.fullPath || !file.url} title="A3 광고 URL 송출 반영">
                    <Upload size={16} />
                    {publishingPath === file.fullPath ? "송출 중" : "송출"}
                  </button>
                  <button className="button danger" onClick={() => deleteFile(file)} disabled={!canWrite || deletingPath === file.fullPath} title="Storage 광고 파일 삭제">
                    <Trash2 size={16} />
                    {deletingPath === file.fullPath ? "삭제 중" : "삭제"}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">Firebase Storage의 `ad_videos/` 폴더에 표시할 영상이 없습니다.</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <FileVideo size={17} />
            광고 파일 송출 집계
          </h2>
          <span className="pill blue">{adAssets.length} assets</span>
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
              <p className="row-meta">Firebase Storage `app_releases/a3/`에 저장하고 `app_releases/a3` 최신 배포 문서를 갱신합니다.</p>
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
              <input type="checkbox" checked={forceUpdate} onChange={(event) => setForceUpdate(event.target.checked)} />
              강제 업데이트 안내
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
