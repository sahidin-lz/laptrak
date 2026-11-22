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

// Validate connection to Firestore on startup as required by SDK guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    // Skip logging other errors, as this is simply a connection test.
  }
}
testConnection();

// ============================================================================
// QUOTA-SAVING FIREBASE SYNC ENGINE ("HEMAT KUOTA HARIAN FIREBASE")
// ============================================================================
// Instead of reading/writing ratusan dokumen terpisah setiap kali buka halaman
// atau upload CSV, seluruh state sekolah dikonsolidasikan ke 1 dokumen bundle
// (/kiosk_bundles/main) dengan Write-Through Debouncing & Local Cache.
// - 1x Load Awal = Hanya 1 Read Firestore (menghemat ratusan read)
// - Bulk CSV 200 baris = Hanya 1 Write Firestore (menghemat 200+ write)
// ============================================================================

const BUNDLE_COLLECTION = 'kiosk_bundles';
const MAIN_BUNDLE_ID = 'main';
const AUDIT_COLLECTION = 'transaction_audits';
const LOCAL_CACHE_KEY = 'laptrack_firebase_quota_cache_v1';
const KIOSK_SYNC_OWNER_ID = 'laptrack-kiosk-sync-v1';

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
let lastWrittenHash = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingStateForSync: AppStatePayload | null = null;

// Track Firebase Auth user state without extra Firestore reads
onAuthStateChanged(auth, (fbUser: FirebaseUser | null) => {
  telemetry = {
    ...telemetry,
    firebaseUserEmail: fbUser?.email || null,
    firebaseUserUid: fbUser?.uid || null,
    syncStatus: fbUser ? 'idle' : 'local_cache',
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
      updatedAtMs: state.updatedAtMs || Date.now(),
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
 * Always queries Firestore directly so Laptop & HP stay synchronized on Vercel even without Google OAuth popup.
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
      const data = snap.data();
      const rawJson = typeof data.payloadJson === 'string' ? data.payloadJson : '';
      const version = typeof data.version === 'number' ? data.version : 1;
      if (rawJson) {
        lastWrittenHash = rawJson;
        const parsed = JSON.parse(rawJson) as Partial<AppStatePayload>;
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
    }

    telemetry = {
      ...telemetry,
      syncStatus: 'idle',
    };
    notifyListeners();
    return localCached;
  } catch (err) {
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
 * so when the Admin uploads 106 laptops on the Laptop, the HP receives them live (and vice-versa).
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
      const data = snap.data();
      const rawJson = typeof data.payloadJson === 'string' ? data.payloadJson : '';
      const version = typeof data.version === 'number' ? data.version : 1;
      if (!rawJson || rawJson === lastWrittenHash) return;

      try {
        lastWrittenHash = rawJson;
        const parsed = JSON.parse(rawJson) as Partial<AppStatePayload>;
        telemetry = {
          ...telemetry,
          bundleVersion: version,
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
 * Enforces all schema and security rule invariants defined in `firestore.rules`.
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

  // Always update local cache immediately (0 Firestore quota used)
  saveStateToLocalQuotaCache(targetState);

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
    updatedAtMs: targetState.updatedAtMs || Date.now(),
  };

  const payloadJson = JSON.stringify(serializable);

  // Deduplicate identical writes to save daily write quota
  if (payloadJson === lastWrittenHash) {
    telemetry = {
      ...telemetry,
      savedOperations: telemetry.savedOperations + 1,
    };
    notifyListeners();
    return true;
  }

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
  const nextVersion = telemetry.bundleVersion + 1;
  const effectiveOwnerId = auth.currentUser?.uid || KIOSK_SYNC_OWNER_ID;

  try {
    telemetry = { ...telemetry, syncStatus: 'syncing', lastError: null };
    notifyListeners();

    if (!bundleExistsOnServer) {
      const checkSnap = await getDoc(bundleRef);
      telemetry.readsUsed += 1;
      bundleExistsOnServer = checkSnap.exists();
      if (bundleExistsOnServer) {
        const existingVersion = checkSnap.data()?.version;
        if (typeof existingVersion === 'number') {
          telemetry.bundleVersion = existingVersion;
        }
      }
    }

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

    lastWrittenHash = payloadJson;
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
  }
}

/**
 * Schedules a debounced, quota-saving write to Firebase Firestore.
 * Multiple rapid mutations (e.g., editing 5 fields or uploading 150 CSV rows)
 * are coalesced into a single Firestore write after `delayMs`.
 */
export function scheduleQuotaSavingFirestoreSync(
  state: AppStatePayload,
  delayMs = 1200
): void {
  pendingStateForSync = state;
  saveStateToLocalQuotaCache(state);

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
 * Writes or updates a compact transaction audit record in `/transaction_audits/{txId}`
 * strictly adhering to `isValidTransactionAudit` rules.
 */
export async function syncTransactionAuditToFirestore(
  tx: Transaction,
  state: AppStatePayload,
  isNewBorrow: boolean
): Promise<void> {
  // Always coalesce state bundle
  scheduleQuotaSavingFirestoreSync(state, 800);

  const cleanTxId = tx.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!cleanTxId) return;

  const student = state.students.find((s) => s.id === tx.student_id);
  const laptop = state.laptops.find((l) => l.id === tx.laptop_id);
  if (!student || !laptop) return;

  const auditRef = doc(db, AUDIT_COLLECTION, cleanTxId);
  const auditPath = `${AUDIT_COLLECTION}/${cleanTxId}`;
  const effectiveOwnerId = auth.currentUser?.uid || KIOSK_SYNC_OWNER_ID;

  try {
    if (isNewBorrow) {
      await setDoc(auditRef, {
        txId: cleanTxId,
        ownerId: effectiveOwnerId,
        studentCode: student.student_code.slice(0, 40),
        studentName: student.name.slice(0, 120),
        assetCode: laptop.asset_code.slice(0, 40),
        transactionType: tx.transaction_type === 'pulang' ? 'pulang' : 'harian',
        status: tx.status === 'returned' ? 'returned' : 'active',
        purpose: (tx.purpose || 'Sesi Harian').slice(0, 160),
        piketName: (tx.piket_name || 'Guru Piket').slice(0, 100),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      telemetry.writesUsed += 1;
      notifyListeners();
    } else {
      await updateDoc(auditRef, {
        ownerId: effectiveOwnerId,
        status: 'returned',
        purpose: (tx.purpose || 'Sudah Dikembalikan').slice(0, 160),
        piketName: (tx.return_piket_name || tx.piket_name || 'Guru Piket').slice(0, 100),
        updatedAt: serverTimestamp(),
      });
      telemetry.writesUsed += 1;
      notifyListeners();
    }
  } catch (err) {
    // If the audit doc didn't exist before return, ignore gracefully as the main bundle stores it
    handleFirestoreError(
      err,
      isNewBorrow ? OperationType.CREATE : OperationType.UPDATE,
      auditPath
    );
  }
}

/**
 * Connects the Admin's Google account via Firebase Authentication (`laptoptrak`)
 * so that rules (`isSignedIn()` + `ownerId == request.auth.uid`) authorize live cloud writes
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
  bundleExistsOnServer = false;
  telemetry = {
    ...telemetry,
    firebaseUserEmail: null,
    firebaseUserUid: null,
    syncStatus: 'local_cache',
  };
  notifyListeners();
}
