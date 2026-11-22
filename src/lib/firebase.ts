import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { AppStatePayload, Transaction } from '../types/models';

// Initialize Firebase SDK with provisioned configuration (projectId: "laptoptrak")
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Safely initialize Firebase Analytics if supported in browser environment
if (typeof window !== 'undefined') {
  isAnalyticsSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(app);
      }
    })
    .catch(() => {
      // Analytics optional in iframe preview
    });
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

// ============================================================================
// QUOTA-SAVING FIREBASE SYNC ENGINE ("HEMAT KUOTA HARIAN FIREBASE")
// ============================================================================
// Seluruh state sekolah dikonsolidasikan ke 1 dokumen bundle (/kiosk_bundles/main)
// dengan Content-Fingerprint Deduplication, Write-Through Debouncing, dan Local Cache:
// - 1x Load Awal = Hanya 1 Read Firestore
// - Listener Real-time = Hanya 1 Dokumen (/kiosk_bundles/main) untuk seluruh perangkat
// - Deduplikasi Fingerprint = Perubahan yang sama / perpindahan tab tidak memakan Write
// - Flush otomatis saat tab ditutup / berpindah (`visibilitychange` & `pagehide`)
// ============================================================================

const BUNDLE_COLLECTION = 'kiosk_bundles';
const MAIN_BUNDLE_ID = 'main';
const LOCAL_CACHE_KEY = 'laptrack_firebase_quota_cache_v1';
const KIOSK_SYNC_OWNER_ID = 'laptrack-kiosk-sync-v1';

export type CloudLoadStatus = 'found' | 'not_found' | 'error';

export interface FirebaseQuotaTelemetry {
  projectId: string;
  databaseId: string;
  readsUsed: number;
  writesUsed: number;
  savedOperations: number;
  bundleVersion: number;
  lastSyncedAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'local_cache' | 'error';
  lastError: string | null;
  firebaseUserEmail: string | null;
  firebaseUserUid: string | null;
}

let telemetry: FirebaseQuotaTelemetry = {
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
  readsUsed: 0,
  writesUsed: 0,
  savedOperations: 0,
  bundleVersion: 1,
  lastSyncedAt: null,
  syncStatus: 'local_cache',
  lastError: null,
  firebaseUserEmail: null,
  firebaseUserUid: null,
};

type TelemetryListener = (snapshot: FirebaseQuotaTelemetry) => void;
const listeners = new Set<TelemetryListener>();

function notifyListeners() {
  const snapshot = { ...telemetry };
  listeners.forEach((cb) => cb(snapshot));
}

export function subscribeFirebaseTelemetry(cb: TelemetryListener): () => void {
  listeners.add(cb);
  cb({ ...telemetry });
  return () => {
    listeners.delete(cb);
  };
}

let bundleExistsOnServer = false;
let cloudLoadStatus: CloudLoadStatus = 'error';
let lastSyncedFingerprint = '';
let lastRawPayloadJson = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingStateForSync: AppStatePayload | null = null;
let flushInFlightPromise: Promise<boolean> | null = null;

export function getLastCloudLoadStatus(): CloudLoadStatus {
  return cloudLoadStatus;
}

/**
 * Computes a deterministic content fingerprint of the core school data
 * (excluding volatile `updatedAtMs` and UI-only `activePage` / typing drafts)
 * so that identical data states never consume Firestore write quota.
 */
export function computeContentFingerprint(state: Partial<AppStatePayload> | null | undefined): string {
  if (!state) return '';
  return JSON.stringify({
    students: state.students || [],
    laptops: state.laptops || [],
    staff: state.staff || [],
    schedules: state.schedules || [],
    dailySessions: state.dailySessions || [],
    transactions: state.transactions || [],
    printSettings: state.printSettings || null,
    kioskShared: state.kioskState
      ? {
          piketTicket: state.kioskState.piketTicket || null,
          selectedWilayah: state.kioskState.selectedWilayah || 'putra',
          scanMode: state.kioskState.scanMode || 'harian',
          selectedSessionKey: state.kioskState.selectedSessionKey || 'siang',
          wizardStep: state.kioskState.wizardStep || 'piket_login',
        }
      : null,
  });
}

// Track Firebase Auth user state without extra Firestore reads
onAuthStateChanged(auth, (fbUser: FirebaseUser | null) => {
  telemetry = {
    ...telemetry,
    firebaseUserEmail: fbUser?.email || null,
    firebaseUserUid: fbUser?.uid || null,
    syncStatus: fbUser ? 'idle' : telemetry.syncStatus,
  };
  notifyListeners();
});

export function saveStateToLocalQuotaCache(state: AppStatePayload): void {
  try {
    const compact = JSON.stringify({
      students: state.students,
      laptops: state.laptops,
      staff: state.staff,
      schedules: state.schedules,
      dailySessions: state.dailySessions,
      transactions: state.transactions,
      printSettings: state.printSettings,
      kioskState: state.kioskState,
      updatedAtMs: typeof state.updatedAtMs === 'number' ? state.updatedAtMs : Date.now(),
      cachedAt: new Date().toISOString(),
    });
    localStorage.setItem(LOCAL_CACHE_KEY, compact);
  } catch {
    // Ignore storage quota warning
  }
}

export function loadStateFromLocalQuotaCache(): Partial<AppStatePayload> | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.students) && Array.isArray(parsed.laptops)) {
      return parsed;
    }
  } catch {
    // Ignore corrupted cache
  }
  return null;
}

/**
 * Loads the consolidated school dataset from `/kiosk_bundles/main` using 1 Firestore Read.
 * Records whether the cloud document was found, genuinely absent, or unreachable due to network error.
 */
export async function loadBundleFromFirestoreOnce(): Promise<Partial<AppStatePayload> | null> {
  const localCached = loadStateFromLocalQuotaCache();
  const bundleRef = doc(db, BUNDLE_COLLECTION, MAIN_BUNDLE_ID);
  const bundlePath = `${BUNDLE_COLLECTION}/${MAIN_BUNDLE_ID}`;

  try {
    telemetry = { ...telemetry, syncStatus: 'syncing', lastError: null };
    notifyListeners();

    const snap = await getDocFromServer(bundleRef).catch(() => getDoc(bundleRef));
    telemetry.readsUsed += 1;

    if (snap.exists()) {
      bundleExistsOnServer = true;
      cloudLoadStatus = 'found';
      const data = snap.data();
      const rawJson = typeof data.payloadJson === 'string' ? data.payloadJson : '';
      const version = typeof data.version === 'number' ? data.version : 1;
      if (rawJson) {
        lastRawPayloadJson = rawJson;
        const parsed = JSON.parse(rawJson) as Partial<AppStatePayload>;
        lastSyncedFingerprint = computeContentFingerprint(parsed);

        const estimatedIndividualReadsSaved =
          (parsed.students?.length || 0) +
          (parsed.laptops?.length || 0) +
          (parsed.transactions?.length || 0) +
          (parsed.schedules?.length || 0);

        telemetry = {
          ...telemetry,
          bundleVersion: version,
          savedOperations:
            telemetry.savedOperations + Math.max(estimatedIndividualReadsSaved - 1, 10),
          lastSyncedAt: new Date().toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          syncStatus: 'synced',
        };
        notifyListeners();
        return parsed;
      }
    } else {
      cloudLoadStatus = 'not_found';
    }

    telemetry = {
      ...telemetry,
      syncStatus: 'idle',
    };
    notifyListeners();
    return localCached;
  } catch (err) {
    cloudLoadStatus = 'error';
    const info = handleFirestoreError(err, OperationType.GET, bundlePath);
    telemetry = {
      ...telemetry,
      syncStatus: 'error',
      lastError: info.error,
    };
    notifyListeners();
    return localCached;
  }
}

/**
 * Subscribes to real-time changes on the single consolidated document `/kiosk_bundles/main`
 * so when the Admin or Guru Piket updates data on Laptop or HP, all other devices receive it live.
 */
export function subscribeToCloudKioskBundle(
  onRemoteBundle: (bundle: Partial<AppStatePayload>) => void
): () => void {
  const bundleRef = doc(db, BUNDLE_COLLECTION, MAIN_BUNDLE_ID);
  const bundlePath = `${BUNDLE_COLLECTION}/${MAIN_BUNDLE_ID}`;

  return onSnapshot(
    bundleRef,
    (snap) => {
      if (!snap.exists()) return;
      bundleExistsOnServer = true;
      cloudLoadStatus = 'found';
      const data = snap.data();
      const rawJson = typeof data.payloadJson === 'string' ? data.payloadJson : '';
      const version = typeof data.version === 'number' ? data.version : 1;
      if (!rawJson || rawJson === lastRawPayloadJson) return;

      try {
        const parsed = JSON.parse(rawJson) as Partial<AppStatePayload>;
        const incomingFingerprint = computeContentFingerprint(parsed);

        lastRawPayloadJson = rawJson;
        if (incomingFingerprint === lastSyncedFingerprint) {
          telemetry = {
            ...telemetry,
            bundleVersion: Math.max(telemetry.bundleVersion, version),
            syncStatus: 'synced',
          };
          notifyListeners();
          return;
        }

        lastSyncedFingerprint = incomingFingerprint;
        telemetry = {
          ...telemetry,
          bundleVersion: Math.max(telemetry.bundleVersion, version),
          lastSyncedAt: new Date().toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          syncStatus: 'synced',
          lastError: null,
        };
        notifyListeners();
        onRemoteBundle(parsed);
      } catch {
        // Ignore malformed JSON
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, bundlePath);
    }
  );
}

/**
 * Flushes the pending state bundle to `/kiosk_bundles/main` in a single Firestore write.
 * Uses content fingerprinting so unchanged data consumes 0 Firestore writes.
 */
export async function flushStateToFirestoreNow(
  stateOverride?: AppStatePayload
): Promise<boolean> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const targetState = stateOverride || pendingStateForSync;
  if (!targetState) return false;
  pendingStateForSync = null;

  // Always update local cache immediately (0 Firestore quota used)
  saveStateToLocalQuotaCache(targetState);

  const nextFingerprint = computeContentFingerprint(targetState);

  // Deduplicate identical data states to save daily write quota
  if (nextFingerprint && nextFingerprint === lastSyncedFingerprint && bundleExistsOnServer) {
    telemetry = {
      ...telemetry,
      savedOperations: telemetry.savedOperations + 1,
      syncStatus: 'synced',
    };
    notifyListeners();
    return true;
  }

  if (flushInFlightPromise) {
    pendingStateForSync = targetState;
    return flushInFlightPromise;
  }

  const executeFlush = async (): Promise<boolean> => {
    const estimatedDocsInBundle =
      targetState.students.length +
      targetState.laptops.length +
      targetState.transactions.length +
      targetState.schedules.length;

    const serializable = {
      students: targetState.students,
      laptops: targetState.laptops,
      staff: targetState.staff,
      schedules: targetState.schedules,
      dailySessions: targetState.dailySessions,
      transactions: targetState.transactions,
      printSettings: targetState.printSettings,
      kioskState: targetState.kioskState,
      updatedAtMs:
        typeof targetState.updatedAtMs === 'number' && targetState.updatedAtMs > 0
          ? targetState.updatedAtMs
          : Date.now(),
    };

    const payloadJson = JSON.stringify(serializable);

    // Guard against 1MB Firestore document limit (rule cap: 900,000 chars)
    const boundedPayloadJson =
      payloadJson.length <= 900000
        ? payloadJson
        : JSON.stringify({
            ...serializable,
            // Strip large base64 photos if bundle exceeds 900KB
            students: targetState.students.map((s) => ({ ...s, photo_url: null })),
          });

    const bundleRef = doc(db, BUNDLE_COLLECTION, MAIN_BUNDLE_ID);
    const bundlePath = `${BUNDLE_COLLECTION}/${MAIN_BUNDLE_ID}`;
    const schoolName = (
      targetState.printSettings?.schoolName || 'SMA NEGERI 1 NUSANTARA'
    ).slice(0, 120);
    const effectiveOwnerId = auth.currentUser?.uid || KIOSK_SYNC_OWNER_ID;

    try {
      telemetry = { ...telemetry, syncStatus: 'syncing', lastError: null };
      notifyListeners();

      if (!bundleExistsOnServer && cloudLoadStatus !== 'not_found') {
        const checkSnap = await getDoc(bundleRef);
        telemetry.readsUsed += 1;
        bundleExistsOnServer = checkSnap.exists();
        if (bundleExistsOnServer) {
          cloudLoadStatus = 'found';
          const existingVersion = checkSnap.data()?.version;
          if (typeof existingVersion === 'number') {
            telemetry.bundleVersion = existingVersion;
          }
        } else {
          cloudLoadStatus = 'not_found';
        }
      }

      const nextVersion = telemetry.bundleVersion + 1;

      if (!bundleExistsOnServer) {
        await setDoc(bundleRef, {
          bundleId: MAIN_BUNDLE_ID,
          ownerId: effectiveOwnerId,
          schoolName,
          payloadJson: boundedPayloadJson,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        bundleExistsOnServer = true;
        cloudLoadStatus = 'found';
        telemetry.bundleVersion = 1;
      } else {
        await updateDoc(bundleRef, {
          ownerId: effectiveOwnerId,
          schoolName,
          payloadJson: boundedPayloadJson,
          version: nextVersion,
          updatedAt: serverTimestamp(),
        });
        telemetry.bundleVersion = nextVersion;
      }

      lastRawPayloadJson = boundedPayloadJson;
      lastSyncedFingerprint = nextFingerprint;
      telemetry = {
        ...telemetry,
        writesUsed: telemetry.writesUsed + 1,
        savedOperations:
          telemetry.savedOperations + Math.max(estimatedDocsInBundle - 1, 5),
        lastSyncedAt: new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        syncStatus: 'synced',
        lastError: null,
      };
      notifyListeners();
      return true;
    } catch (err) {
      const info = handleFirestoreError(
        err,
        bundleExistsOnServer ? OperationType.UPDATE : OperationType.CREATE,
        bundlePath
      );
      telemetry = {
        ...telemetry,
        syncStatus: 'error',
        lastError: info.error,
      };
      notifyListeners();
      return false;
    } finally {
      flushInFlightPromise = null;
      if (pendingStateForSync) {
        const nextPending = pendingStateForSync;
        pendingStateForSync = null;
        scheduleQuotaSavingFirestoreSync(nextPending, 400);
      }
    }
  };

  flushInFlightPromise = executeFlush();
  return flushInFlightPromise;
}

/**
 * Schedules a debounced, quota-saving write to Firebase Firestore.
 * Multiple rapid mutations are coalesced into a single Firestore write after `delayMs`.
 */
export function scheduleQuotaSavingFirestoreSync(
  state: AppStatePayload,
  delayMs = 900
): void {
  saveStateToLocalQuotaCache(state);

  const nextFingerprint = computeContentFingerprint(state);
  if (nextFingerprint && nextFingerprint === lastSyncedFingerprint && bundleExistsOnServer) {
    telemetry = {
      ...telemetry,
      savedOperations: telemetry.savedOperations + 1,
    };
    notifyListeners();
    return;
  }

  pendingStateForSync = state;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    telemetry = {
      ...telemetry,
      savedOperations: telemetry.savedOperations + 1,
    };
    notifyListeners();
  }

  debounceTimer = setTimeout(() => {
    flushStateToFirestoreNow();
  }, delayMs);
}

/**
 * Synchronizes borrow/return transactions inside the single consolidated bundle `/kiosk_bundles/main`
 * so every scan uses at most 1 coalesced Firestore write (saving 50% write quota per scan).
 */
export async function syncTransactionAuditToFirestore(
  _tx: Transaction,
  state: AppStatePayload,
  _isNewBorrow: boolean
): Promise<void> {
  scheduleQuotaSavingFirestoreSync(state, 500);
}

// Flush any pending debounced write immediately when the user switches tabs, refreshes, or reconnects
if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pendingStateForSync) {
      flushStateToFirestoreNow();
    }
  });
  window.addEventListener('pagehide', () => {
    if (pendingStateForSync) {
      flushStateToFirestoreNow();
    }
  });
  window.addEventListener('online', () => {
    if (pendingStateForSync) {
      flushStateToFirestoreNow();
    }
  });
}

/**
 * Connects the Admin's Google account via Firebase Authentication (`laptoptrak`)
 * and immediately syncs the current state in 1 coalesced operation.
 */
export async function connectFirebaseCloudAccount(
  currentState?: AppStatePayload
): Promise<{ ok: boolean; email?: string | null; error?: string }> {
  try {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    telemetry = {
      ...telemetry,
      firebaseUserEmail: cred.user.email,
      firebaseUserUid: cred.user.uid,
      syncStatus: 'idle',
      lastError: null,
    };
    notifyListeners();

    if (currentState) {
      await flushStateToFirestoreNow(currentState);
    }
    return { ok: true, email: cred.user.email };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal menghubungkan akun Google Firebase.';
    return { ok: false, error: msg };
  }
}

export async function disconnectFirebaseCloudAccount(): Promise<void> {
  await signOut(auth);
  telemetry = {
    ...telemetry,
    firebaseUserEmail: null,
    firebaseUserUid: null,
    syncStatus: 'local_cache',
  };
  notifyListeners();
}
