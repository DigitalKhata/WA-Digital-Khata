import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
  deleteUser,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  type User
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  enableNetwork,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  collection,
  getDocs,
  updateDoc,
  onSnapshot,
  Bytes,
  query,
  orderBy,
  limit,
  type Firestore
} from 'firebase/firestore';
import appletFirebaseConfig from '../firebase-applet-config.json';

const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
const envProjectId = String(envMeta.VITE_FIREBASE_PROJECT_ID || '').trim();
const envAuthDomain = String(envMeta.VITE_FIREBASE_AUTH_DOMAIN || '').trim();

export const firebaseConfig = {
  ...appletFirebaseConfig,
  ...(envMeta.VITE_FIREBASE_API_KEY ? { apiKey: envMeta.VITE_FIREBASE_API_KEY.trim() } : {}),
  ...(envProjectId ? { projectId: envProjectId } : {}),
  ...(envAuthDomain
    ? { authDomain: envAuthDomain }
    : envProjectId
      ? { authDomain: `${envProjectId}.firebaseapp.com` }
      : {}),
  ...(envMeta.VITE_FIREBASE_STORAGE_BUCKET
    ? { storageBucket: envMeta.VITE_FIREBASE_STORAGE_BUCKET.trim() }
    : envProjectId
      ? { storageBucket: `${envProjectId}.firebasestorage.app` }
      : {}),
  ...(envMeta.VITE_FIREBASE_MESSAGING_SENDER_ID
    ? { messagingSenderId: envMeta.VITE_FIREBASE_MESSAGING_SENDER_ID.trim() }
    : {}),
  ...(envMeta.VITE_FIREBASE_APP_ID ? { appId: envMeta.VITE_FIREBASE_APP_ID.trim() } : {}),
  ...(envMeta.VITE_FIREBASE_DATABASE_ID !== undefined
    ? { firestoreDatabaseId: envMeta.VITE_FIREBASE_DATABASE_ID.trim() || '(default)' }
    : envProjectId && envProjectId !== appletFirebaseConfig.projectId
      ? { firestoreDatabaseId: '(default)' }
      : {}),
  ...(envMeta.VITE_GOOGLE_OAUTH_CLIENT_ID
    ? { oAuthClientId: envMeta.VITE_GOOGLE_OAUTH_CLIENT_ID.trim() }
    : {})
};

export const ADMIN_EMAIL = 'haroonirfan086@gmail.com';

export function isAdminEmail(email: string | null | undefined): boolean {
  return String(email || '').trim().toLowerCase() === ADMIN_EMAIL;
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

const app = initializeApp(firebaseConfig);

let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      }),
      experimentalForceLongPolling: true
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  try {
    dbInstance = initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = dbInstance;
export const auth = getAuth(app);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void enableNetwork(dbInstance).catch(() => {});
  });
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
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
          photoUrl: provider.photoURL
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  try {
    await getDoc(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error || '');
    const code = String((error as { code?: string })?.code || '');
    const isOfflineErr =
      code === 'unavailable' ||
      msg.includes('the client is offline') ||
      msg.includes('Could not reach Cloud Firestore backend');
    if (isOfflineErr) {
      try {
        await enableNetwork(db);
      } catch {
        // ignore transient offline retry error
      }
      return false;
    }
    return true;
  }
}

export function normalizeMobileDigits(rawMobile: string): string {
  let digits = String(rawMobile || '').replace(/\D/g, '');
  if (digits.startsWith('0092') && digits.length === 14) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = '92' + digits.slice(1);
  }
  return digits;
}

export function normalizeIdentifier(rawInput: string): {
  authType: 'email' | 'mobile';
  authEmail: string;
  email: string;
  mobile: string;
  normalizedMobile: string;
  identifier: string;
} {
  const clean = String(rawInput || '').trim();
  if (!clean) {
    throw new Error('Please enter Email or Mobile Number.');
  }
  if (clean.includes('@')) {
    const email = clean.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please enter a valid Email Address.');
    }
    return {
      authType: 'email',
      authEmail: email,
      email,
      mobile: '',
      normalizedMobile: '',
      identifier: email
    };
  }
  const digits = normalizeMobileDigits(clean);
  if (digits.length < 8 || digits.length > 15) {
    throw new Error('Enter a valid Email or Mobile Number (e.g. 03001234567).');
  }
  return {
    authType: 'mobile',
    authEmail: `m_${digits}@mobile.digitalkhata.app`,
    email: '',
    mobile: clean,
    normalizedMobile: digits,
    identifier: clean
  };
}

const VAULT_MAX_BYTES = 880000;

function safeStringifyBounded(obj: Record<string, unknown>): string {
  const s = JSON.stringify(obj);
  if (s.length <= VAULT_MAX_BYTES) return s;
  const clone: Record<string, unknown> = { ...obj };
  if (Array.isArray(clone.archivedReports) && clone.archivedReports.length > 36) {
    clone.archivedReports = clone.archivedReports.slice(-36);
  }
  const s2 = JSON.stringify(clone);
  if (s2.length <= VAULT_MAX_BYTES) return s2;
  if (clone.settings && typeof clone.settings === 'object') {
    clone.settings = { ...(clone.settings as Record<string, unknown>), customLogo: '' };
  }
  const s3 = JSON.stringify(clone);
  return s3.length <= VAULT_MAX_BYTES ? s3 : '{}';
}

const ADMIN_BACKUP_JSON_MAX = 440000;
const PROFILE_PIC_MAX = 280000;

function extractSafeProfilePic(
  explicitPic: unknown,
  appState: Record<string, unknown>,
  existingData?: Record<string, unknown> | null,
  existingBackup?: Record<string, unknown> | null
): string {
  const sessionObj = (appState.session && typeof appState.session === 'object' ? appState.session : {}) as Record<string, unknown>;
  const kycObj = (appState.kyc && typeof appState.kyc === 'object' ? appState.kyc : {}) as Record<string, unknown>;
  const settingsObj = (appState.settings && typeof appState.settings === 'object' ? appState.settings : {}) as Record<string, unknown>;
  const candidates = [
    explicitPic,
    sessionObj.photo,
    kycObj.selfiePhoto,
    settingsObj.customLogo,
    existingData?.profilePicUrl,
    existingBackup?.profilePicUrl
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0 && c.length <= PROFILE_PIC_MAX) {
      return c.trim();
    }
  }
  return '';
}

function countWorkshopRecords(dataObj: Record<string, unknown>): number {
  const keys = [
    'customers', 'orders', 'customerPayments', 'transactions', 'stock',
    'suppliers', 'supplierEntries', 'partyPayments', 'staff', 'staffLogs',
    'salaryHistory', 'messEntries', 'rentRecords', 'rentPayments',
    'committees', 'archivedReports'
  ];
  let total = 0;
  for (const k of keys) {
    const val = dataObj[k];
    if (Array.isArray(val)) total += val.length;
  }
  return total;
}

function buildAdminSnapshotObject(appState: Record<string, unknown>): Record<string, unknown> {
  return {
    settings: appState.settings && typeof appState.settings === 'object' ? appState.settings : {},
    customers: Array.isArray(appState.customers) ? appState.customers : [],
    orders: Array.isArray(appState.orders) ? appState.orders : [],
    customerPayments: Array.isArray(appState.customerPayments) ? appState.customerPayments : [],
    transactions: Array.isArray(appState.transactions) ? appState.transactions : [],
    stock: Array.isArray(appState.stock) ? appState.stock : [],
    suppliers: Array.isArray(appState.suppliers) ? appState.suppliers : [],
    supplierEntries: Array.isArray(appState.supplierEntries) ? appState.supplierEntries : [],
    partyPayments: Array.isArray(appState.partyPayments) ? appState.partyPayments : [],
    staff: Array.isArray(appState.staff) ? appState.staff : [],
    staffLogs: Array.isArray(appState.staffLogs) ? appState.staffLogs : [],
    salaryHistory: Array.isArray(appState.salaryHistory) ? appState.salaryHistory : [],
    messEntries: Array.isArray(appState.messEntries) ? appState.messEntries : [],
    rentRecords: Array.isArray(appState.rentRecords) ? appState.rentRecords : [],
    rentPayments: Array.isArray(appState.rentPayments) ? appState.rentPayments : [],
    committees: Array.isArray(appState.committees) ? appState.committees : [],
    archivedReports: Array.isArray(appState.archivedReports) ? appState.archivedReports : [],
    lastActiveMonth: typeof appState.lastActiveMonth === 'string' ? appState.lastActiveMonth : '',
    kyc: appState.kyc && typeof appState.kyc === 'object' ? appState.kyc : {}
  };
}

function safeAdminBackupJson(snapshotObj: Record<string, unknown>): string {
  const s = JSON.stringify(snapshotObj);
  if (s.length <= ADMIN_BACKUP_JSON_MAX) return s;
  const clone: Record<string, unknown> = { ...snapshotObj };
  if (clone.kyc && typeof clone.kyc === 'object') {
    clone.kyc = { ...(clone.kyc as Record<string, unknown>), frontPhoto: '', backPhoto: '', selfiePhoto: '' };
  }
  if (clone.settings && typeof clone.settings === 'object') {
    const st: Record<string, unknown> = { ...(clone.settings as Record<string, unknown>), customLogo: '' };
    if (st.signatures && typeof st.signatures === 'object') {
      const sigs = { ...(st.signatures as Record<string, unknown>) };
      if (sigs.owner1 && typeof sigs.owner1 === 'object') {
        sigs.owner1 = { ...(sigs.owner1 as Record<string, unknown>), dataUrl: '' };
      }
      st.signatures = sigs;
    }
    clone.settings = st;
  }
  const s2 = JSON.stringify(clone);
  if (s2.length <= ADMIN_BACKUP_JSON_MAX) return s2;
  if (Array.isArray(clone.archivedReports) && clone.archivedReports.length > 24) {
    clone.archivedReports = clone.archivedReports.slice(-24);
  }
  const s3 = JSON.stringify(clone);
  if (s3.length <= ADMIN_BACKUP_JSON_MAX) return s3;
  return '{}';
}

export function normalizeCnic13(rawCnic: string): string {
  const trimmed = String(rawCnic || '').trim();
  if (!trimmed) {
    throw new Error('CNIC 13 digits ka hona chahiye (e.g. 35202-1234567-1 ya 3520212345671).');
  }
  // Allow only digits, dashes, or spaces; must normalize to exact 13 digits
  if (!/^[\d\s-]+$/.test(trimmed)) {
    throw new Error('CNIC me sirf 13 digits (dashes ke sath ya bagair) likhein.');
  }
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(digits)) {
    throw new Error('CNIC sirf 13 digits ka hona chahiye (e.g. 35202-1234567-1 ya 3520212345671).');
  }
  // If dashes were used, validate standard 5-7-1 format or clean strips cleanly
  if (trimmed.includes('-') && !/^\d{5}-\d{7}-\d$/.test(trimmed)) {
    throw new Error('CNIC dash format 35202-1234567-1 jaisa rakhein ya bina dash ke 13 digits likhein.');
  }
  return digits;
}

export function formatCnicDashed(rawCnic: string): string {
  try {
    const d = normalizeCnic13(rawCnic);
    return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
  } catch {
    return String(rawCnic || '');
  }
}

export async function hashCnic(rawCnic: string): Promise<string> {
  const clean = normalizeCnic13(rawCnic);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dk_cnic_v1:${clean}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashMobile(rawMobile: string): Promise<string> {
  const digits = normalizeMobileDigits(rawMobile);
  if (digits.length < 8 || digits.length > 15) {
    throw new Error('Valid Mobile Number enter karein.');
  }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dk_mobile_v1:${digits}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function claimCnicForUser(rawCnic: string, uid: string): Promise<string> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Please sign in first.');
  }
  const cnicHash = await hashCnic(rawCnic);
  const ref = doc(db, 'cnicRegistry', cnicHash);
  let snap;
  try {
    snap = await getDocFromServer(ref);
  } catch {
    snap = await getDoc(ref);
  }
  if (snap.exists()) {
    const existingUid = String(snap.data()?.uid || '');
    if (existingUid === uid) return cnicHash;
    throw new Error('Ye ID Card pehle se ek Account se linked hai. 1 ID Card se sirf 1 Account ban sakta hai.');
  }
  try {
    await setDoc(ref, {
      cnicHash,
      uid,
      createdAt: Date.now()
    });
    return cnicHash;
  } catch {
    const check = await getDoc(ref).catch(() => null);
    if (check && check.exists() && String(check.data()?.uid || '') === uid) {
      return cnicHash;
    }
    throw new Error('Ye ID Card pehle se ek Account se linked hai. 1 ID Card se sirf 1 Account ban sakta hai.');
  }
}

export async function checkOrClaimLegacyCnic(
  rawCnic: string,
  uid: string
): Promise<{ isDuplicate: boolean; ownerUid: string; cnicHash: string }> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Please sign in first.');
  }
  const cnicHash = await hashCnic(rawCnic);
  const ref = doc(db, 'cnicRegistry', cnicHash);
  let snap;
  try {
    snap = await getDocFromServer(ref);
  } catch {
    snap = await getDoc(ref);
  }
  if (snap.exists()) {
    const ownerUid = String(snap.data()?.uid || '');
    return {
      isDuplicate: Boolean(ownerUid && ownerUid !== uid),
      ownerUid: ownerUid || uid,
      cnicHash
    };
  }
  try {
    await setDoc(ref, {
      cnicHash,
      uid,
      createdAt: Date.now()
    });
    return { isDuplicate: false, ownerUid: uid, cnicHash };
  } catch {
    const check = await getDoc(ref).catch(() => null);
    const ownerUid = check && check.exists() ? String(check.data()?.uid || '') : '';
    return {
      isDuplicate: Boolean(ownerUid && ownerUid !== uid),
      ownerUid: ownerUid || uid,
      cnicHash
    };
  }
}

export async function claimMobileForUser(rawMobile: string, uid: string): Promise<string> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Please sign in first.');
  }
  const digits = normalizeMobileDigits(rawMobile);
  if (digits.length < 8) return '';
  const mobileHash = await hashMobile(digits);
  const ref = doc(db, 'mobileRegistry', mobileHash);
  let snap;
  try {
    snap = await getDocFromServer(ref);
  } catch {
    snap = await getDoc(ref);
  }
  if (snap.exists()) {
    const existingUid = String(snap.data()?.uid || '');
    if (existingUid === uid) return mobileHash;
    throw new Error('Ye Mobile Number pehle se ek Account me registered hai. 1 Mobile = 1 Account.');
  }
  try {
    await setDoc(ref, {
      mobileHash,
      uid,
      createdAt: Date.now()
    });
    return mobileHash;
  } catch {
    const check = await getDoc(ref).catch(() => null);
    if (check && check.exists() && String(check.data()?.uid || '') === uid) {
      return mobileHash;
    }
    throw new Error('Ye Mobile Number pehle se ek Account me registered hai. 1 Mobile = 1 Account.');
  }
}

export interface CloudUserBundle {
  profile: Record<string, unknown> | null;
  vaultData: Record<string, unknown>;
  hasCloudData: boolean;
  latestBackup: Record<string, unknown> | null;
}

export interface AdminUserInspection {
  profile: Record<string, unknown> | null;
  vaultData: Record<string, unknown>;
  backups: Array<Record<string, unknown>>;
  adminBackup: Record<string, unknown> | null;
}

function computeSummaryStats(appState: Record<string, unknown>): {
  totalKhataAmount: number;
  totalPendingAmount: number;
  customerCount: number;
  cnicLast4: string;
  kycStatus: 'none' | 'verifying' | 'approved' | 'duplicate';
} {
  const customers = Array.isArray(appState.customers) ? appState.customers : [];
  const orders = Array.isArray(appState.orders) ? appState.orders : [];
  const custPayments = Array.isArray(appState.customerPayments) ? appState.customerPayments : [];
  const suppliers = Array.isArray(appState.suppliers) ? appState.suppliers : [];
  const supplierEntries = Array.isArray(appState.supplierEntries) ? appState.supplierEntries : [];
  const partyPayments = Array.isArray(appState.partyPayments) ? appState.partyPayments : [];

  let totalKhataAmount = 0;
  let customerPending = 0;

  for (const c of customers) {
    if (!c || typeof c !== 'object') continue;
    const cid = String((c as Record<string, unknown>).id || '');
    const opening = Number((c as Record<string, unknown>).openingBalance || 0);
    let bill = opening;
    for (const o of orders) {
      if (o && typeof o === 'object' && String((o as Record<string, unknown>).customerId || '') === cid) {
        const rec = o as Record<string, unknown>;
        bill += Number(rec.totalAmount ?? Number(rec.sqft || 0) * Number(rec.rate || 0));
      }
    }
    let paid = 0;
    for (const o of orders) {
      if (o && typeof o === 'object' && String((o as Record<string, unknown>).customerId || '') === cid) {
        paid += Number((o as Record<string, unknown>).advance || 0);
      }
    }
    for (const p of custPayments) {
      if (p && typeof p === 'object' && String((p as Record<string, unknown>).customerId || '') === cid) {
        paid += Number((p as Record<string, unknown>).amount || 0);
      }
    }
    totalKhataAmount += Math.max(0, bill);
    customerPending += Math.max(0, bill - paid);
  }

  let partyPending = 0;
  for (const s of suppliers) {
    if (!s || typeof s !== 'object') continue;
    const sid = String((s as Record<string, unknown>).id || '');
    let total = 0;
    for (const e of supplierEntries) {
      if (e && typeof e === 'object' && String((e as Record<string, unknown>).supplierId || '') === sid) {
        total += Number((e as Record<string, unknown>).amount || 0);
      }
    }
    let paid = 0;
    for (const p of partyPayments) {
      if (p && typeof p === 'object' && String((p as Record<string, unknown>).supplierId || '') === sid) {
        paid += Number((p as Record<string, unknown>).amount || 0);
      }
    }
    partyPending += Math.max(0, total - paid);
  }

  const kyc = (appState.kyc && typeof appState.kyc === 'object' ? appState.kyc : {}) as Record<string, unknown>;
  const rawCnic = String(kyc.cnic || '').replace(/\D/g, '');
  const kycStatusRaw = String(kyc.status || 'none');
  const kycStatus: 'none' | 'verifying' | 'approved' | 'duplicate' =
    kycStatusRaw === 'approved' || kycStatusRaw === 'verifying' || kycStatusRaw === 'duplicate'
      ? kycStatusRaw
      : 'none';

  return {
    totalKhataAmount: Math.round(totalKhataAmount),
    totalPendingAmount: Math.round(customerPending + partyPending),
    customerCount: customers.length,
    cnicLast4: rawCnic.length >= 4 ? rawCnic.slice(-4) : '',
    kycStatus
  };
}

export const dkCloud = {
  firebaseConfig,
  auth,
  db,
  ADMIN_EMAIL,
  isAdminEmail,
  testConnection,
  normalizeIdentifier,
  normalizeMobileDigits,
  normalizeCnic13,
  formatCnicDashed,
  hashCnic,
  hashMobile,
  claimCnicForUser,
  checkOrClaimLegacyCnic,
  claimMobileForUser,

  onAuthChange(cb: (user: User | null) => void) {
    return onAuthStateChanged(auth, cb);
  },

  async signUp(
    name: string,
    identifier: string,
    password: string,
    cnic?: string,
    extraMobile?: string,
    termsAccepted = true
  ) {
    const cleanName = String(name || '').trim().slice(0, 120);
    if (!cleanName) throw new Error('Full Name is required.');
    const validCnic = cnic !== undefined && cnic !== '' ? normalizeCnic13(cnic) : '';
    const norm = normalizeIdentifier(identifier);
    const mobileCandidate = extraMobile ? String(extraMobile).trim() : norm.mobile;

    const cred = await createUserWithEmailAndPassword(auth, norm.authEmail, password);

    let cnicHash = '';
    let mobileHash = '';
    try {
      if (validCnic) {
        cnicHash = await claimCnicForUser(validCnic, cred.user.uid);
      }
      if (mobileCandidate && normalizeMobileDigits(mobileCandidate).length >= 8) {
        mobileHash = await claimMobileForUser(mobileCandidate, cred.user.uid);
      }
    } catch (claimErr) {
      try {
        await deleteUser(cred.user);
      } catch {
        try { await signOut(auth); } catch { /* ignore */ }
      }
      throw claimErr;
    }

    await updateProfile(cred.user, { displayName: cleanName });
    const now = Date.now();
    const acceptedTerms = Boolean(termsAccepted);
    const profileDoc = {
      uid: cred.user.uid,
      name: cleanName,
      identifier: norm.identifier.slice(0, 160),
      email: norm.email.slice(0, 160),
      mobile: mobileCandidate.slice(0, 40),
      authType: norm.authType,
      pinEnabled: false,
      pinHash: '',
      cnicHash,
      cnicLast4: validCnic ? validCnic.slice(-4) : '',
      mobileHash,
      kycStatus: 'none' as const,
      kycDuplicateOf: '',
      blocked: false,
      activeDeviceId: '',
      activeDeviceName: '',
      activeSessionId: '',
      activeDeviceCount: 0,
      sessionVersion: 1,
      lastLoginAt: now,
      totalKhataAmount: 0,
      totalPendingAmount: 0,
      customerCount: 0,
      lastSyncAt: now,
      lastBackupAt: 0,
      profilePicUrl: '',
      termsAccepted: acceptedTerms,
      termsAcceptedAt: acceptedTerms ? now : 0,
      lastAdminRestoreAt: 0,
      createdAt: now,
      updatedAt: now
    };
    const userPath = `users/${cred.user.uid}`;
    try {
      await setDoc(doc(db, 'users', cred.user.uid), profileDoc);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }

    // Create initial Admin Backup record for the new user
    try {
      const emptySnapJson = JSON.stringify({ customers: [], orders: [], transactions: [] });
      await setDoc(doc(db, 'adminBackups', cred.user.uid), {
        uid: cred.user.uid,
        userId: cred.user.uid,
        name: cleanName,
        profilePicUrl: '',
        phone: mobileCandidate.slice(0, 40),
        email: norm.email.slice(0, 160),
        termsAccepted: acceptedTerms,
        termsAcceptedAt: acceptedTerms ? now : 0,
        recordCount: 0,
        isDataDeleted: false,
        deletedAt: 0,
        allUserDataJson: emptySnapJson,
        lastGoodBackupJson: emptySnapJson,
        lastBackupAt: now,
        lastRestoredAt: 0,
        lastRestoredBy: '',
        updatedAt: now
      });
    } catch {
      /* non-fatal during initial signup; saveUserVault will retry */
    }

    return { user: cred.user, profile: profileDoc, norm, cnic: validCnic };
  },

  async signIn(identifier: string, password: string) {
    const norm = normalizeIdentifier(identifier);
    const cred = await signInWithEmailAndPassword(auth, norm.authEmail, password);
    return { user: cred.user, norm };
  },

  async sendReset(identifier: string) {
    const norm = normalizeIdentifier(identifier);
    if (norm.authType !== 'email') {
      throw new Error('Password reset link is sent to Email accounts. For Mobile accounts, use your saved password or contact workshop admin.');
    }
    await sendPasswordResetEmail(auth, norm.authEmail);
  },

  async updateUserPassword(newPassword: string) {
    if (!auth.currentUser) throw new Error('Not signed in.');
    await updatePassword(auth.currentUser, newPassword);
  },

  async signOutUser() {
    await signOut(auth);
  },

  async signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    provider.addScope('openid');
    provider.addScope('email');
    provider.addScope('profile');
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await signInWithPopup(auth, provider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = cred?.accessToken || '';
      const isNewUser = await this._ensureGoogleUserRecords(result.user);
      return { user: result.user, accessToken, isNewUser };
    } catch (err: unknown) {
      const code = String((err as { code?: string })?.code || '');
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, provider);
        return { user: null, accessToken: '', isNewUser: false, redirected: true };
      }
      throw err;
    }
  },

  async consumeGoogleRedirectResult() {
    try {
      const result = await getRedirectResult(auth);
      if (!result || !result.user) return null;
      const cred = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = cred?.accessToken || '';
      const isNewUser = await this._ensureGoogleUserRecords(result.user);
      return { user: result.user, accessToken, isNewUser };
    } catch (err) {
      console.warn('Google redirect result warning:', err);
      return null;
    }
  },

  async _ensureGoogleUserRecords(fbUser: User): Promise<boolean> {
    const uid = fbUser.uid;
    const now = Date.now();
    const existingSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
    if (existingSnap && existingSnap.exists()) {
      return false;
    }
    const cleanEmail = String(fbUser.email || '').trim().toLowerCase().slice(0, 160);
    const emailPrefix = cleanEmail.includes('@') ? cleanEmail.split('@')[0] : '';
    const cleanName = String(
      fbUser.displayName ||
      (emailPrefix ? emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1) : 'Workshop Owner')
    ).trim().slice(0, 120);
    const photoUrl = String(fbUser.photoURL || '').slice(0, PROFILE_PIC_MAX);

    const profileDoc = {
      uid,
      name: cleanName,
      identifier: cleanEmail,
      email: cleanEmail,
      mobile: String(fbUser.phoneNumber || '').slice(0, 40),
      authType: 'email' as const,
      pinEnabled: false,
      pinHash: '',
      cnicHash: '',
      cnicLast4: '',
      mobileHash: '',
      kycStatus: 'none' as const,
      kycDuplicateOf: '',
      blocked: false,
      activeDeviceId: '',
      activeDeviceName: '',
      activeSessionId: '',
      activeDeviceCount: 0,
      sessionVersion: 1,
      lastLoginAt: now,
      totalKhataAmount: 0,
      totalPendingAmount: 0,
      customerCount: 0,
      lastSyncAt: now,
      lastBackupAt: 0,
      profilePicUrl: photoUrl,
      termsAccepted: true,
      termsAcceptedAt: now,
      lastAdminRestoreAt: 0,
      createdAt: now,
      updatedAt: now
    };
    try {
      await setDoc(doc(db, 'users', uid), profileDoc);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
    }
    try {
      const emptySnapJson = JSON.stringify({ customers: [], orders: [], transactions: [] });
      await setDoc(doc(db, 'adminBackups', uid), {
        uid,
        userId: uid,
        name: cleanName,
        profilePicUrl: photoUrl,
        phone: '',
        email: cleanEmail,
        termsAccepted: true,
        termsAcceptedAt: now,
        recordCount: 0,
        isDataDeleted: false,
        deletedAt: 0,
        allUserDataJson: emptySnapJson,
        lastGoodBackupJson: emptySnapJson,
        lastBackupAt: now,
        lastRestoredAt: 0,
        lastRestoredBy: '',
        updatedAt: now
      });
    } catch {
      /* non-fatal */
    }
    return true;
  },

  async adminSendPasswordReset(email: string) {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      throw new Error('User does not have a valid email address for password reset.');
    }
    await sendPasswordResetEmail(auth, clean);
  },

  async loadUserBundle(uid: string): Promise<CloudUserBundle> {
    const emptyBundle: CloudUserBundle = { profile: null, vaultData: {}, hasCloudData: false, latestBackup: null };
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      return emptyBundle;
    }

    // Ensure Firebase ID token is attached before Firestore queries (prevents permission race on restore/reload)
    try {
      await auth.currentUser.getIdToken();
    } catch {
      // continue to local cache / offline Firestore if offline
    }
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      return emptyBundle;
    }

    const userPath = `users/${uid}`;
    let profile: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) profile = snap.data();
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) return emptyBundle;
      const code = String((err as { code?: string })?.code || '');
      if (code === 'unavailable' || code === 'permission-denied') {
        console.warn('loadUserBundle profile read warning:', code);
        return emptyBundle;
      }
      handleFirestoreError(err, OperationType.GET, userPath);
    }

    const vaultData: Record<string, unknown> = {};
    let hasCloudData = false;
    const shardIds = ['core', 'ledger', 'operations', 'kyc'] as const;

    for (const shardId of shardIds) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) {
        return emptyBundle;
      }
      const shardPath = `users/${uid}/vault/${shardId}`;
      try {
        const snap = await getDoc(doc(db, 'users', uid, 'vault', shardId));
        if (snap.exists()) {
          const d = snap.data();
          if (typeof d.payloadJson === 'string' && d.payloadJson.length >= 2) {
            const parsed = JSON.parse(d.payloadJson);
            Object.assign(vaultData, parsed);
            hasCloudData = true;
          }
        }
      } catch (err) {
        if (!auth.currentUser || auth.currentUser.uid !== uid) return emptyBundle;
        const code = String((err as { code?: string })?.code || '');
        if (code === 'unavailable' || code === 'permission-denied') {
          console.warn('loadUserBundle shard read warning:', shardPath, code);
          continue;
        }
        handleFirestoreError(err, OperationType.GET, shardPath);
      }
    }

    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      return emptyBundle;
    }

    let latestBackup: Record<string, unknown> | null = null;
    const backupsPath = `users/${uid}/backups`;
    try {
      const q = query(collection(db, 'users', uid, 'backups'), orderBy('createdAt', 'desc'), limit(1));
      const snaps = await getDocs(q);
      if (!snaps.empty) {
        latestBackup = snaps.docs[0].data();
      }
    } catch (err) {
      // Backup metadata query is optional fallback; never crash hydration on transient auth/network errors
      console.warn('loadUserBundle backups list skipped:', backupsPath, (err as { code?: string })?.code || err);
    }

    return { profile, vaultData, hasCloudData, latestBackup };
  },

  async saveUserVault(
    uid: string,
    meta: {
      name: string;
      identifier?: string;
      email?: string;
      mobile?: string;
      authType?: 'email' | 'mobile';
      pinEnabled?: boolean;
      pinHash?: string;
      cnicHash?: string;
      mobileHash?: string;
      kycDuplicateOf?: string;
      profilePicUrl?: string;
      termsAccepted?: boolean;
      termsAcceptedAt?: number;
      forceDataDeleted?: boolean;
      lastBackupAt?: number;
      createdAt?: number;
    },
    appState: Record<string, unknown>
  ): Promise<number> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error('AUTH_SESSION_CHANGED');
    }
    const now = Date.now();
    const userPath = `users/${uid}`;
    const existingSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
    const existingData = existingSnap && existingSnap.exists() ? existingSnap.data() : null;

    if (existingData?.blocked === true && !isAdminEmail(auth.currentUser?.email)) {
      throw new Error('ACCOUNT_BLOCKED');
    }

    const summary = computeSummaryStats(appState);
    // Preserve duplicate lock unless Admin resolved it
    const effectiveKycStatus =
      existingData?.kycStatus === 'duplicate' && !isAdminEmail(auth.currentUser?.email)
        ? 'duplicate'
        : existingData?.kycStatus === 'approved' && summary.kycStatus !== 'approved'
          ? 'approved'
          : summary.kycStatus;

    let cnicHashToSave = String(meta.cnicHash ?? existingData?.cnicHash ?? '').slice(0, 64);
    const rawKyc = (appState.kyc as Record<string, unknown>) || {};
    if (!cnicHashToSave && typeof rawKyc.cnic === 'string' && rawKyc.cnic.trim()) {
      try {
        cnicHashToSave = await hashCnic(rawKyc.cnic);
      } catch { /* ignore invalid draft CNIC */ }
    }

    const rawKycMobile = typeof rawKyc.mobile === 'string' ? rawKyc.mobile : '';
    const mobileStr = String(meta.mobile || rawKycMobile || existingData?.mobile || '').slice(0, 40);
    let mobileHashToSave = String(meta.mobileHash ?? existingData?.mobileHash ?? '').slice(0, 64);
    if (!mobileHashToSave && mobileStr && normalizeMobileDigits(mobileStr).length >= 8) {
      try {
        mobileHashToSave = await hashMobile(mobileStr);
      } catch { /* ignore */ }
    }

    const profilePicUrl = extractSafeProfilePic(meta.profilePicUrl, appState, existingData);
    const termsAccepted = meta.termsAccepted !== undefined
      ? Boolean(meta.termsAccepted)
      : Boolean(existingData?.termsAccepted ?? true);
    const termsAcceptedAt = Number(
      meta.termsAcceptedAt ??
      existingData?.termsAcceptedAt ??
      (termsAccepted ? Number(existingData?.createdAt ?? now) : 0)
    );

    const profileDoc: Record<string, unknown> = {
      uid,
      name: String(meta.name || existingData?.name || 'Workshop Owner').slice(0, 120),
      identifier: String(meta.identifier ?? existingData?.identifier ?? '').slice(0, 160),
      email: String(meta.email ?? existingData?.email ?? '').slice(0, 160),
      mobile: mobileStr,
      authType: meta.authType === 'mobile' || existingData?.authType === 'mobile' ? 'mobile' : 'email',
      pinEnabled: Boolean(meta.pinEnabled ?? existingData?.pinEnabled ?? false),
      pinHash: String(meta.pinHash ?? existingData?.pinHash ?? '').slice(0, 128),
      cnicHash: cnicHashToSave,
      cnicLast4: summary.cnicLast4 || String(existingData?.cnicLast4 || '').slice(0, 8),
      mobileHash: mobileHashToSave,
      kycStatus: effectiveKycStatus,
      kycDuplicateOf: String(meta.kycDuplicateOf ?? existingData?.kycDuplicateOf ?? '').slice(0, 128),
      blocked: Boolean(existingData?.blocked ?? false),
      activeDeviceId: String(existingData?.activeDeviceId ?? '').slice(0, 128),
      activeDeviceName: String(existingData?.activeDeviceName ?? '').slice(0, 160),
      activeSessionId: String(existingData?.activeSessionId ?? '').slice(0, 128),
      activeDeviceCount: Number(existingData?.activeDeviceCount ?? 0),
      sessionVersion: Number(existingData?.sessionVersion ?? 1),
      lastLoginAt: Number(existingData?.lastLoginAt ?? 0),
      totalKhataAmount: summary.totalKhataAmount,
      totalPendingAmount: summary.totalPendingAmount,
      customerCount: summary.customerCount,
      lastSyncAt: now,
      lastBackupAt: Number(meta.lastBackupAt ?? existingData?.lastBackupAt ?? 0),
      profilePicUrl,
      termsAccepted,
      termsAcceptedAt,
      createdAt: Number(existingData?.createdAt ?? meta.createdAt ?? now),
      updatedAt: now
    };
    if (!existingData) {
      profileDoc.lastAdminRestoreAt = 0;
    } else if ('lastAdminRestoreAt' in existingData) {
      profileDoc.lastAdminRestoreAt = Number(existingData.lastAdminRestoreAt || 0);
    }

    try {
      await setDoc(doc(db, 'users', uid), profileDoc);
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error('AUTH_SESSION_CHANGED');
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }

    const corePayload = {
      settings: appState.settings || {},
      customers: appState.customers || [],
      orders: appState.orders || [],
      customerPayments: appState.customerPayments || []
    };
    const ledgerPayload = {
      transactions: appState.transactions || [],
      suppliers: appState.suppliers || [],
      supplierEntries: appState.supplierEntries || [],
      partyPayments: appState.partyPayments || []
    };
    const opsPayload = {
      stock: appState.stock || [],
      staff: appState.staff || [],
      staffLogs: appState.staffLogs || [],
      salaryHistory: appState.salaryHistory || [],
      messEntries: appState.messEntries || [],
      rentRecords: appState.rentRecords || [],
      rentPayments: appState.rentPayments || [],
      committees: appState.committees || [],
      archivedReports: appState.archivedReports || [],
      lastActiveMonth: appState.lastActiveMonth || ''
    };

    let kycJson = JSON.stringify({ kyc: rawKyc });
    if (kycJson.length > VAULT_MAX_BYTES) {
      kycJson = JSON.stringify({
        kyc: {
          ...rawKyc,
          frontPhoto: '',
          backPhoto: '',
          selfiePhoto: ''
        }
      });
    }

    const shards: Array<{ id: 'core' | 'ledger' | 'operations' | 'kyc'; payloadJson: string }> = [
      { id: 'core', payloadJson: safeStringifyBounded(corePayload) },
      { id: 'ledger', payloadJson: safeStringifyBounded(ledgerPayload) },
      { id: 'operations', payloadJson: safeStringifyBounded(opsPayload) },
      { id: 'kyc', payloadJson: kycJson }
    ];

    for (const shard of shards) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) {
        throw new Error('AUTH_SESSION_CHANGED');
      }
      const shardPath = `users/${uid}/vault/${shard.id}`;
      try {
        await setDoc(doc(db, 'users', uid, 'vault', shard.id), {
          uid,
          docType: shard.id,
          payloadJson: shard.payloadJson,
          updatedAt: now
        });
      } catch (err) {
        if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error('AUTH_SESSION_CHANGED');
        handleFirestoreError(err, OperationType.WRITE, shardPath);
      }
    }

    // Real-time Auto Backup copy in Admin Database (/adminBackups/{uid})
    try {
      await this.syncAdminBackupSnapshot(
        uid,
        {
          name: String(profileDoc.name || 'Workshop Owner'),
          email: String(profileDoc.email || ''),
          phone: mobileStr,
          profilePicUrl,
          termsAccepted,
          termsAcceptedAt,
          forceDataDeleted: Boolean(meta.forceDataDeleted)
        },
        appState,
        existingData
      );
    } catch (adminBackupErr) {
      console.warn('Admin Auto Backup sync warning:', adminBackupErr);
    }

    return now;
  },

  async appendAdminActivityLog(entry: {
    uid: string;
    userName: string;
    action: 'AUTO_BACKUP' | 'MANUAL_BACKUP' | 'DATA_CLEARED' | 'RESTORE_USER_DATA';
    performedBy: string;
    performedByRole: 'user' | 'admin';
    details?: string;
  }): Promise<void> {
    if (!auth.currentUser) return;
    const now = Date.now();
    const logId = this._randomSafeId('act_', 18);
    const { dateStr, timeStr } = this._formatDateTimeParts(now);
    const path = `adminActivityLogs/${logId}`;
    try {
      await setDoc(doc(db, 'adminActivityLogs', logId), {
        id: logId,
        uid: String(entry.uid || '').slice(0, 128),
        userName: String(entry.userName || 'Workshop User').slice(0, 120),
        action: entry.action,
        performedBy: String(entry.performedBy || 'User').slice(0, 160),
        performedByRole: entry.performedByRole,
        details: String(entry.details || '').slice(0, 300),
        dateStr,
        timeStr,
        createdAt: now
      });
    } catch (err) {
      console.warn('Admin activity log warning:', path, err);
    }
  },

  async syncAdminBackupSnapshot(
    uid: string,
    meta: {
      name: string;
      email?: string;
      phone?: string;
      profilePicUrl?: string;
      termsAccepted?: boolean;
      termsAcceptedAt?: number;
      forceDataDeleted?: boolean;
    },
    appState: Record<string, unknown>,
    existingProfile?: Record<string, unknown> | null
  ): Promise<void> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    const now = Date.now();
    const backupRef = doc(db, 'adminBackups', uid);
    const existingSnap = await getDoc(backupRef).catch(() => null);
    const existingBackup = existingSnap && existingSnap.exists() ? existingSnap.data() : null;

    const snapObj = buildAdminSnapshotObject(appState);
    const allUserDataJson = safeAdminBackupJson(snapObj);
    const recordCount = countWorkshopRecords(snapObj);
    const prevRecordCount = Number(existingBackup?.recordCount || 0);
    const wasDeleted = Boolean(existingBackup?.isDataDeleted);

    const isDataDeleted = Boolean(
      meta.forceDataDeleted ||
      (recordCount === 0 && (prevRecordCount > 0 || wasDeleted))
    );

    const existingGoodJson = String(existingBackup?.lastGoodBackupJson || '');
    const lastGoodBackupJson =
      recordCount > 0
        ? allUserDataJson
        : (isDataDeleted && existingGoodJson.length > 2 ? existingGoodJson : allUserDataJson);

    const profilePicUrl = extractSafeProfilePic(meta.profilePicUrl, appState, existingProfile, existingBackup);
    const phone = String(meta.phone || existingBackup?.phone || existingProfile?.mobile || '').slice(0, 40);
    const email = String(meta.email || existingBackup?.email || existingProfile?.email || '').slice(0, 160);
    const name = String(meta.name || existingBackup?.name || existingProfile?.name || 'Workshop Owner').slice(0, 120);
    const termsAccepted = meta.termsAccepted !== undefined
      ? Boolean(meta.termsAccepted)
      : Boolean(existingBackup?.termsAccepted ?? existingProfile?.termsAccepted ?? true);
    const termsAcceptedAt = Number(
      meta.termsAcceptedAt ??
      existingBackup?.termsAcceptedAt ??
      existingProfile?.termsAcceptedAt ??
      now
    );
    const deletedAt = isDataDeleted
      ? (meta.forceDataDeleted || !wasDeleted ? now : Number(existingBackup?.deletedAt || now))
      : 0;

    const payload: Record<string, unknown> = {
      uid,
      userId: uid,
      name,
      profilePicUrl,
      phone,
      email,
      termsAccepted,
      termsAcceptedAt,
      recordCount,
      isDataDeleted,
      deletedAt,
      allUserDataJson,
      lastGoodBackupJson,
      lastBackupAt: now,
      updatedAt: now
    };
    if (!existingBackup) {
      payload.lastRestoredAt = 0;
      payload.lastRestoredBy = '';
    } else {
      if ('lastRestoredAt' in existingBackup) {
        payload.lastRestoredAt = Number(existingBackup.lastRestoredAt || 0);
      }
      if ('lastRestoredBy' in existingBackup) {
        payload.lastRestoredBy = String(existingBackup.lastRestoredBy || '').slice(0, 160);
      }
    }

    const prevJson = String(existingBackup?.allUserDataJson || '');
    const dataChanged = prevJson !== allUserDataJson || Boolean(meta.forceDataDeleted);

    try {
      await setDoc(backupRef, payload);
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) return;
      handleFirestoreError(err, OperationType.WRITE, `adminBackups/${uid}`);
    }

    if (dataChanged) {
      const actionType: 'AUTO_BACKUP' | 'DATA_CLEARED' = isDataDeleted ? 'DATA_CLEARED' : 'AUTO_BACKUP';
      const detailText = isDataDeleted
        ? `User data cleared/deleted (previous snapshot preserved: ${lastGoodBackupJson.length} bytes).`
        : `Real-time auto backup saved (${recordCount} records).`;
      await this.appendAdminActivityLog({
        uid,
        userName: name,
        action: actionType,
        performedBy: email || phone || name,
        performedByRole: 'user',
        details: detailText
      });
    }
  },

  async saveBackupSnapshot(
    uid: string,
    kind: 'daily' | 'manual',
    dateKey: string,
    label: string,
    payloadObj: Record<string, unknown>
  ): Promise<number> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error('AUTH_SESSION_CHANGED');
    }
    const now = Date.now();
    const id = kind === 'daily' ? `daily_${dateKey}` : `manual_${now}`;
    let payloadJson = JSON.stringify(payloadObj);
    if (payloadJson.length > VAULT_MAX_BYTES) {
      const d = { ...(payloadObj.data as Record<string, unknown>) };
      if (d.kyc && typeof d.kyc === 'object') {
        d.kyc = { ...(d.kyc as Record<string, unknown>), frontPhoto: '', backPhoto: '', selfiePhoto: '' };
      }
      if (d.settings && typeof d.settings === 'object') {
        d.settings = { ...(d.settings as Record<string, unknown>), customLogo: '' };
      }
      payloadJson = JSON.stringify({ ...payloadObj, data: d });
    }
    if (payloadJson.length > VAULT_MAX_BYTES) {
      throw new Error('Backup size exceeds 900KB Firestore document limit.');
    }

    const backupPath = `users/${uid}/backups/${id}`;
    try {
      await setDoc(doc(db, 'users', uid, 'backups', id), {
        uid,
        id,
        kind,
        dateKey,
        label: String(label || dateKey).slice(0, 120),
        payloadJson,
        createdAt: now
      });
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error('AUTH_SESSION_CHANGED');
      handleFirestoreError(err, OperationType.WRITE, backupPath);
    }

    const userPath = `users/${uid}`;
    let snapName = String(auth.currentUser.displayName || 'Workshop User');
    let snapActor = String(auth.currentUser.email || snapName);
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        const sd = snap.data();
        snapName = String(sd.name || snapName);
        snapActor = String(sd.email || sd.mobile || snapName);
        await setDoc(doc(db, 'users', uid), {
          ...sd,
          lastBackupAt: now,
          updatedAt: now
        });
      }
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error('AUTH_SESSION_CHANGED');
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }

    if (kind === 'manual') {
      await this.appendAdminActivityLog({
        uid,
        userName: snapName,
        action: 'MANUAL_BACKUP',
        performedBy: snapActor,
        performedByRole: 'user',
        details: `Manual JSON snapshot saved (${dateKey}).`
      });
    }

    return now;
  },

  async restoreLatestBackup(uid: string): Promise<{ payload: Record<string, unknown>; label: string; createdAt: number } | null> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      return null;
    }
    const backupsPath = `users/${uid}/backups`;
    try {
      const q = query(collection(db, 'users', uid, 'backups'), orderBy('createdAt', 'desc'), limit(1));
      const snaps = await getDocs(q);
      if (snaps.empty) return null;
      const d = snaps.docs[0].data();
      const payload = JSON.parse(String(d.payloadJson || '{}'));
      return { payload, label: String(d.label || d.dateKey || ''), createdAt: Number(d.createdAt || 0) };
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
      handleFirestoreError(err, OperationType.LIST, backupsPath);
    }
  },

  // ---------------- SINGLE DEVICE BINDING, APPROVAL & LOGIN HISTORY ----------------
  async _sha256Bytes(rawText: string): Promise<Bytes> {
    const encoded = new TextEncoder().encode(String(rawText || ''));
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Bytes.fromUint8Array(new Uint8Array(digest));
  },

  _randomSafeId(prefix: string, len = 24): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    let out = prefix;
    for (let i = 0; i < len; i++) {
      out += chars[arr[i] % chars.length];
    }
    return out;
  },

  _formatDateTimeParts(ts: number): { dateStr: string; timeStr: string; fullStr: string } {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = String(hours % 12 || 12).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const timeStr = `${h12}:${mins} ${ampm}`;
    return { dateStr, timeStr, fullStr: `${dateStr} ${timeStr}` };
  },

  async _ensureUserProfileDoc(
    uid: string,
    fallbackName?: string
  ): Promise<Record<string, unknown>> {
    const userRef = doc(db, 'users', uid);
    let snap = null;
    try {
      snap = await getDocFromServer(userRef);
    } catch {
      try {
        snap = await getDoc(userRef);
      } catch {
        snap = null;
      }
    }
    if (snap && snap.exists()) {
      return snap.data();
    }
    const now = Date.now();
    const email = String(auth.currentUser?.email || '');
    const isSyntheticMobile = email.endsWith('@mobile.digitalkhata.app');
    const baseProfile = {
      uid,
      name: String(fallbackName || auth.currentUser?.displayName || 'Workshop Owner').slice(0, 120),
      identifier: email.slice(0, 160),
      email: isSyntheticMobile ? '' : email.slice(0, 160),
      mobile: '',
      authType: isSyntheticMobile ? 'mobile' : 'email',
      pinEnabled: false,
      pinHash: '',
      cnicHash: '',
      cnicLast4: '',
      mobileHash: '',
      kycStatus: 'none',
      kycDuplicateOf: '',
      blocked: false,
      activeDeviceId: '',
      activeDeviceName: '',
      activeSessionId: '',
      activeDeviceCount: 0,
      sessionVersion: 1,
      lastLoginAt: 0,
      totalKhataAmount: 0,
      totalPendingAmount: 0,
      customerCount: 0,
      lastSyncAt: now,
      lastBackupAt: 0,
      profilePicUrl: '',
      termsAccepted: true,
      termsAcceptedAt: now,
      lastAdminRestoreAt: 0,
      createdAt: now,
      updatedAt: now
    };
    try {
      await setDoc(userRef, baseProfile);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
    }
    return baseProfile;
  },

  async _appendLoginHistory(
    uid: string,
    meta: {
      deviceId: string;
      deviceName: string;
      isUnknown?: boolean;
      ip: string;
      location: string;
      browserVersion: string;
    },
    status: 'Allowed' | 'Blocked'
  ): Promise<void> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    const now = Date.now();
    const entryId = this._randomSafeId('lh_', 18);
    const { dateStr, timeStr } = this._formatDateTimeParts(now);
    const displayName = meta.isUnknown || !meta.deviceName || meta.deviceName === 'Unknown Device'
      ? 'Unknown Device'
      : String(meta.deviceName).slice(0, 160);
    const path = `users/${uid}/loginHistory/${entryId}`;
    try {
      await setDoc(doc(db, 'users', uid, 'loginHistory', entryId), {
        uid,
        id: entryId,
        deviceId: String(meta.deviceId || '').slice(0, 128),
        deviceName: displayName,
        isUnknown: Boolean(meta.isUnknown || displayName === 'Unknown Device'),
        ip: String(meta.ip || 'Unknown').slice(0, 64),
        location: String(meta.location || 'Unknown Location').slice(0, 160),
        browserVersion: String(meta.browserVersion || 'Digital Khata Web v1.0').slice(0, 160),
        status,
        dateStr,
        timeStr,
        createdAt: now
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  },

  async _bindApprovedDeviceAsSoleActive(
    uid: string,
    profileData: Record<string, unknown>,
    deviceMeta: {
      deviceId: string;
      deviceName: string;
      isUnknown?: boolean;
      ip: string;
      location: string;
      browserVersion: string;
    },
    existingDevices: Array<Record<string, unknown>>,
    recordHistory: boolean
  ): Promise<{ sessionId: string; sessionVersion: number }> {
    const now = Date.now();
    const sessionId = this._randomSafeId('sess_', 20);
    const sessionVersion = Number(profileData?.sessionVersion || 1);
    const displayName = deviceMeta.isUnknown || !deviceMeta.deviceName
      ? 'Unknown Device'
      : String(deviceMeta.deviceName).slice(0, 160);

    // Deactivate all other devices so strictly 1 mobile/device is active at a time
    for (const d of existingDevices) {
      const otherId = String(d.deviceId || '');
      if (!otherId || otherId === deviceMeta.deviceId) continue;
      if (d.isActive || d.sessionId) {
        try {
          await setDoc(doc(db, 'users', uid, 'devices', otherId), {
            uid,
            deviceId: otherId,
            deviceName: String(d.deviceName || 'Unknown Device').slice(0, 160),
            browserVersion: String(d.browserVersion || '').slice(0, 160),
            ip: String(d.ip || '').slice(0, 64),
            location: String(d.location || '').slice(0, 160),
            status: d.status === 'revoked' ? 'revoked' : 'approved',
            isActive: false,
            sessionId: '',
            approvedAt: Number(d.approvedAt || now),
            lastSeenAt: Number(d.lastSeenAt || now)
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/devices/${otherId}`);
        }
      }
    }

    const myExisting = existingDevices.find((d) => String(d.deviceId || '') === deviceMeta.deviceId);
    const devPath = `users/${uid}/devices/${deviceMeta.deviceId}`;
    try {
      await setDoc(doc(db, 'users', uid, 'devices', deviceMeta.deviceId), {
        uid,
        deviceId: deviceMeta.deviceId,
        deviceName: displayName,
        browserVersion: String(deviceMeta.browserVersion || '').slice(0, 160),
        ip: String(deviceMeta.ip || '').slice(0, 64),
        location: String(deviceMeta.location || '').slice(0, 160),
        status: 'approved',
        isActive: true,
        sessionId,
        approvedAt: Number(myExisting?.approvedAt || now),
        lastSeenAt: now
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, devPath);
    }

    try {
      await setDoc(doc(db, 'users', uid), {
        ...profileData,
        uid,
        activeDeviceId: deviceMeta.deviceId,
        activeDeviceName: displayName,
        activeSessionId: sessionId,
        activeDeviceCount: 1,
        sessionVersion,
        lastLoginAt: now,
        updatedAt: now
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }

    if (recordHistory) {
      await this._appendLoginHistory(uid, deviceMeta, 'Allowed');
    }

    return { sessionId, sessionVersion };
  },

  async registerOrCheckDeviceLogin(
    uid: string,
    deviceMeta: {
      deviceId: string;
      deviceName: string;
      isUnknown?: boolean;
      ip: string;
      location: string;
      browserVersion: string;
      loginDateTime: string;
      recordHistory?: boolean;
      localSessionId?: string;
    }
  ): Promise<
    | {
        status: 'approved';
        sessionId: string;
        sessionVersion: number;
        isFirstDevice: boolean;
      }
    | {
        status: 'pending_approval';
        reqId: string;
        approvalToken: string;
        ownerEmail: string;
        ownerName: string;
      }
  > {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error('AUTH_SESSION_CHANGED');
    }
    const profileData = await this._ensureUserProfileDoc(uid);

    if (profileData.blocked === true && !isAdminEmail(auth.currentUser.email)) {
      throw new Error('ACCOUNT_BLOCKED');
    }

    let existingDevices: Array<Record<string, unknown>> = [];
    try {
      const snaps = await getDocs(collection(db, 'users', uid, 'devices'));
      existingDevices = snaps.docs.map((s) => s.data());
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/devices`);
    }

    const myDevice = existingDevices.find((d) => String(d.deviceId || '') === deviceMeta.deviceId);
    const hasAnyApprovedDevice = existingDevices.some((d) => d.status === 'approved');
    const profileHasActiveBinding = Boolean(String(profileData.activeDeviceId || '').trim());

    // Same device reopening app with matching active binding OR previously approved (not revoked) device
    if (
      (myDevice && myDevice.status === 'approved') ||
      (!hasAnyApprovedDevice && !profileHasActiveBinding)
    ) {
      const isFirstDevice = !hasAnyApprovedDevice && !profileHasActiveBinding;
      // Preserve existing active sessionId if this is just an app reopen on the already-active device
      if (
        !isFirstDevice &&
        deviceMeta.recordHistory === false &&
        String(profileData.activeDeviceId || '') === deviceMeta.deviceId &&
        String(profileData.activeSessionId || '') &&
        (!deviceMeta.localSessionId || deviceMeta.localSessionId === String(profileData.activeSessionId || ''))
      ) {
        return {
          status: 'approved',
          sessionId: String(profileData.activeSessionId),
          sessionVersion: Number(profileData.sessionVersion || 1),
          isFirstDevice: false
        };
      }
      const { sessionId, sessionVersion } = await this._bindApprovedDeviceAsSoleActive(
        uid,
        profileData,
        deviceMeta,
        existingDevices,
        deviceMeta.recordHistory !== false
      );
      return { status: 'approved', sessionId, sessionVersion, isFirstDevice };
    }

    // New, unknown, or previously revoked device -> MUST wait indefinitely for Owner Email ALLOW / NOT ALLOW
    const reqId = this._randomSafeId('req_', 26);
    const approvalToken = this._randomSafeId('tok_', 28);
    const tokenHash = await this._sha256Bytes(approvalToken);
    const now = Date.now();
    const linkPath = `deviceApprovalLinks/${reqId}`;

    try {
      await setDoc(doc(db, 'deviceApprovalLinks', reqId), {
        reqId,
        uid,
        deviceId: deviceMeta.deviceId,
        deviceName: (deviceMeta.isUnknown || !deviceMeta.deviceName ? 'Unknown Device' : deviceMeta.deviceName).slice(0, 160),
        ip: String(deviceMeta.ip || 'Unknown').slice(0, 64),
        location: String(deviceMeta.location || 'Unknown Location').slice(0, 160),
        browserVersion: String(deviceMeta.browserVersion || 'Digital Khata Web v1.0').slice(0, 160),
        loginDateTime: String(deviceMeta.loginDateTime || this._formatDateTimeParts(now).fullStr).slice(0, 100),
        decision: 'pending',
        tokenHash,
        approvalToken: '',
        createdAt: now,
        decidedAt: 0
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, linkPath);
    }

    const ownerEmail =
      String(profileData.email || '').trim() ||
      (auth.currentUser.email && !auth.currentUser.email.endsWith('@mobile.digitalkhata.app')
        ? auth.currentUser.email
        : '');
    const ownerName = String(profileData.name || auth.currentUser.displayName || 'Workshop Owner');

    return {
      status: 'pending_approval',
      reqId,
      approvalToken,
      ownerEmail,
      ownerName
    };
  },

  watchDeviceApprovalLink(
    reqId: string,
    onUpdate: (info: { decision: 'pending' | 'allowed' | 'denied'; decidedAt: number; data: Record<string, unknown> }) => void,
    onError?: (err: unknown) => void
  ): () => void {
    const path = `deviceApprovalLinks/${reqId}`;
    return onSnapshot(
      doc(db, 'deviceApprovalLinks', reqId),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const rawDec = String(d.decision || 'pending');
        const decision: 'pending' | 'allowed' | 'denied' =
          rawDec === 'allowed' || rawDec === 'denied' ? rawDec : 'pending';
        onUpdate({ decision, decidedAt: Number(d.decidedAt || 0), data: d });
      },
      (err) => {
        if (onError) onError(err);
        else handleFirestoreError(err, OperationType.GET, path);
      }
    );
  },

  async getDeviceApprovalInfo(reqId: string): Promise<Record<string, unknown> | null> {
    const ref = doc(db, 'deviceApprovalLinks', reqId);
    try {
      const snap = await getDocFromServer(ref);
      return snap.exists() ? snap.data() : null;
    } catch {
      try {
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `deviceApprovalLinks/${reqId}`);
      }
    }
  },

  async resolveDeviceApprovalLink(
    reqId: string,
    decision: 'allowed' | 'denied',
    rawToken: string
  ): Promise<{ alreadyResolved: boolean; decision: 'allowed' | 'denied' | 'pending'; data: Record<string, unknown> | null }> {
    const ref = doc(db, 'deviceApprovalLinks', reqId);
    const snap = await getDocFromServer(ref).catch(() => getDoc(ref));
    if (!snap.exists()) {
      throw new Error('Approval request not found.');
    }
    const current = snap.data();
    if (current.decision === 'allowed' || current.decision === 'denied') {
      return {
        alreadyResolved: true,
        decision: current.decision,
        data: current
      };
    }
    const cleanToken = String(rawToken || '').trim();
    if (cleanToken.length < 16) {
      throw new Error('Invalid security approval token.');
    }
    try {
      await updateDoc(ref, {
        decision,
        decidedAt: Date.now(),
        approvalToken: cleanToken
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `deviceApprovalLinks/${reqId}`);
    }
    const updated = { ...current, decision, decidedAt: Date.now() };
    return { alreadyResolved: false, decision, data: updated };
  },

  async finalizeApprovedDeviceLogin(
    uid: string,
    deviceMeta: {
      deviceId: string;
      deviceName: string;
      isUnknown?: boolean;
      ip: string;
      location: string;
      browserVersion: string;
    }
  ): Promise<{ sessionId: string; sessionVersion: number }> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error('AUTH_SESSION_CHANGED');
    }
    const profileData = await this._ensureUserProfileDoc(uid);
    let existingDevices: Array<Record<string, unknown>> = [];
    try {
      const snaps = await getDocs(collection(db, 'users', uid, 'devices'));
      existingDevices = snaps.docs.map((s) => s.data());
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/devices`);
    }
    return this._bindApprovedDeviceAsSoleActive(uid, profileData, deviceMeta, existingDevices, true);
  },

  async recordBlockedLoginAttempt(
    uid: string,
    deviceMeta: {
      deviceId: string;
      deviceName: string;
      isUnknown?: boolean;
      ip: string;
      location: string;
      browserVersion: string;
    }
  ): Promise<void> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    await this._ensureUserProfileDoc(uid);
    await this._appendLoginHistory(uid, deviceMeta, 'Blocked');
  },

  watchUserActiveSession(
    uid: string,
    deviceId: string,
    sessionId: string,
    localSessionVersion: number,
    onRevoked: (reason: 'other_device' | 'logout_all' | 'blocked' | 'revoked') => void,
    onAdminRestore?: (restoredAt: number) => void,
    initialAdminRestoreAt = 0
  ): () => void {
    const userPath = `users/${uid}`;
    let fired = false;
    let lastKnownRestoreAt = Number(initialAdminRestoreAt || 0);
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (fired || !snap.exists()) return;
        const d = snap.data();
        if (d.blocked === true && !isAdminEmail(auth.currentUser?.email)) {
          fired = true;
          onRevoked('blocked');
          return;
        }
        const remoteVersion = Number(d.sessionVersion || 1);
        const remoteDeviceId = String(d.activeDeviceId || '');
        const remoteSessionId = String(d.activeSessionId || '');
        const activeCount = Number(d.activeDeviceCount ?? 1);

        if (remoteVersion > Number(localSessionVersion || 1)) {
          fired = true;
          onRevoked('logout_all');
          return;
        }
        if (activeCount === 0 && !remoteDeviceId && !remoteSessionId) {
          fired = true;
          onRevoked('logout_all');
          return;
        }
        if (remoteDeviceId && remoteDeviceId !== deviceId) {
          fired = true;
          onRevoked('other_device');
          return;
        }
        if (remoteSessionId && sessionId && remoteSessionId !== sessionId) {
          fired = true;
          onRevoked('other_device');
          return;
        }
        const remoteRestoreAt = Number(d.lastAdminRestoreAt || 0);
        if (remoteRestoreAt > lastKnownRestoreAt) {
          lastKnownRestoreAt = remoteRestoreAt;
          if (onAdminRestore) onAdminRestore(remoteRestoreAt);
        }
      },
      (err) => {
        if (!auth.currentUser || auth.currentUser.uid !== uid) return;
        console.warn('Session watcher warning:', userPath, err);
      }
    );
  },

  async logoutAllUserDevices(uid: string): Promise<void> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error('Not signed in.');
    }
    const now = Date.now();
    const profileData = await this._ensureUserProfileDoc(uid);
    const nextVersion = Number(profileData.sessionVersion || 1) + 1;

    try {
      const devSnaps = await getDocs(collection(db, 'users', uid, 'devices'));
      for (const s of devSnaps.docs) {
        const d = s.data();
        const dId = String(d.deviceId || s.id);
        await setDoc(doc(db, 'users', uid, 'devices', dId), {
          uid,
          deviceId: dId,
          deviceName: String(d.deviceName || 'Unknown Device').slice(0, 160),
          browserVersion: String(d.browserVersion || '').slice(0, 160),
          ip: String(d.ip || '').slice(0, 64),
          location: String(d.location || '').slice(0, 160),
          status: 'revoked',
          isActive: false,
          sessionId: '',
          approvedAt: Number(d.approvedAt || now),
          lastSeenAt: now
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/devices`);
    }

    try {
      await setDoc(doc(db, 'users', uid), {
        ...profileData,
        uid,
        activeDeviceId: '',
        activeDeviceName: '',
        activeSessionId: '',
        activeDeviceCount: 0,
        sessionVersion: nextVersion,
        updatedAt: now
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  },

  async listLoginHistory(uid: string): Promise<Array<Record<string, unknown>>> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
    const path = `users/${uid}/loginHistory`;
    try {
      const q = query(collection(db, 'users', uid, 'loginHistory'), orderBy('createdAt', 'desc'), limit(100));
      const snaps = await getDocs(q);
      return snaps.docs.map((d) => d.data());
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },

  async getActiveDeviceSummary(uid: string): Promise<{
    activeCount: number;
    activeDeviceName: string;
    activeDeviceId: string;
    lastLoginAt: number;
    devices: Array<Record<string, unknown>>;
  }> {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      return { activeCount: 0, activeDeviceName: '', activeDeviceId: '', lastLoginAt: 0, devices: [] };
    }
    let profile: Record<string, unknown> = {};
    try {
      const pSnap = await getDoc(doc(db, 'users', uid));
      if (pSnap.exists()) profile = pSnap.data();
    } catch (err) {
      console.warn('getActiveDeviceSummary profile warning:', (err as { code?: string })?.code || err);
    }
    let devices: Array<Record<string, unknown>> = [];
    try {
      const dSnaps = await getDocs(collection(db, 'users', uid, 'devices'));
      devices = dSnaps.docs.map((s) => s.data());
    } catch (err) {
      console.warn('getActiveDeviceSummary devices warning:', (err as { code?: string })?.code || err);
    }
    const activeDevices = devices.filter((d) => d.isActive === true && d.status === 'approved');
    const activeCount = Math.max(
      activeDevices.length,
      Number(profile.activeDeviceCount || (profile.activeDeviceId ? 1 : 0))
    );
    return {
      activeCount,
      activeDeviceName: String(profile.activeDeviceName || activeDevices[0]?.deviceName || ''),
      activeDeviceId: String(profile.activeDeviceId || activeDevices[0]?.deviceId || ''),
      lastLoginAt: Number(profile.lastLoginAt || 0),
      devices
    };
  },

  // ---------------- ADMIN PANEL OPERATIONS ----------------
  async adminListAllUsers(options?: { skipBackups?: boolean }): Promise<Array<Record<string, unknown>>> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    try {
      const userSnapsPromise = getDocs(collection(db, 'users'));
      const backupSnapsPromise = options?.skipBackups
        ? Promise.resolve(null)
        : getDocs(collection(db, 'adminBackups')).catch(() => null);
      const [userSnaps, backupSnaps] = await Promise.all([userSnapsPromise, backupSnapsPromise]);
      const backupMap = new Map<string, Record<string, unknown>>();
      if (backupSnaps) {
        backupSnaps.docs.forEach((bDoc) => {
          const bd = bDoc.data();
          const bUid = String(bd.uid || bd.userId || bDoc.id);
          backupMap.set(bUid, bd);
        });
      }
      const userMap = new Map<string, Record<string, unknown>>();
      userSnaps.docs.forEach((d) => {
        const u = d.data();
        const uUid = String(u.uid || d.id);
        const bk = backupMap.get(uUid);
        userMap.set(uUid, {
          ...u,
          uid: uUid,
          userId: uUid,
          profilePicUrl: String(bk?.profilePicUrl || u.profilePicUrl || ''),
          phone: String(u.mobile || bk?.phone || ''),
          mobile: String(u.mobile || bk?.phone || ''),
          email: String(u.email || bk?.email || ''),
          isDataDeleted: Boolean(bk?.isDataDeleted ?? false),
          deletedAt: Number(bk?.deletedAt ?? 0),
          recordCount: Number(bk?.recordCount ?? u.customerCount ?? 0),
          adminBackupAt: Number(bk?.lastBackupAt ?? bk?.updatedAt ?? u.lastSyncAt ?? 0),
          lastRestoredAt: Number(bk?.lastRestoredAt ?? u.lastAdminRestoreAt ?? 0),
          lastRestoredBy: String(bk?.lastRestoredBy ?? '')
        });
      });
      // Include any user present in adminBackups even if profile doc was removed
      backupMap.forEach((bk, bUid) => {
        if (!userMap.has(bUid)) {
          userMap.set(bUid, {
            uid: bUid,
            userId: bUid,
            name: String(bk.name || 'User'),
            profilePicUrl: String(bk.profilePicUrl || ''),
            phone: String(bk.phone || ''),
            mobile: String(bk.phone || ''),
            email: String(bk.email || ''),
            kycStatus: 'none',
            blocked: false,
            customerCount: 0,
            totalPendingAmount: 0,
            isDataDeleted: Boolean(bk.isDataDeleted ?? false),
            deletedAt: Number(bk.deletedAt ?? 0),
            recordCount: Number(bk.recordCount ?? 0),
            adminBackupAt: Number(bk.lastBackupAt ?? bk.updatedAt ?? 0),
            lastRestoredAt: Number(bk.lastRestoredAt ?? 0),
            lastRestoredBy: String(bk.lastRestoredBy ?? ''),
            createdAt: Number(bk.updatedAt || 0)
          });
        }
      });
      const list = Array.from(userMap.values());
      list.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      return list;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'users');
    }
  },

  async adminLoadUserInspection(uid: string): Promise<AdminUserInspection> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    const shardIds = ['core', 'ledger', 'operations', 'kyc'] as const;

    const [profileSnap, abSnap, shardSnaps, backupsSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid)).catch((err) => {
        handleFirestoreError(err, OperationType.GET, `users/${uid}`);
        return null;
      }),
      getDoc(doc(db, 'adminBackups', uid)).catch((err) => {
        handleFirestoreError(err, OperationType.GET, `adminBackups/${uid}`);
        return null;
      }),
      Promise.all(
        shardIds.map((shardId) =>
          getDoc(doc(db, 'users', uid, 'vault', shardId)).catch((err) => {
            handleFirestoreError(err, OperationType.GET, `users/${uid}/vault/${shardId}`);
            return null;
          })
        )
      ),
      getDocs(query(collection(db, 'users', uid, 'backups'), orderBy('createdAt', 'desc'), limit(10))).catch(() => null)
    ]);

    const profile: Record<string, unknown> | null = profileSnap && profileSnap.exists() ? profileSnap.data() : null;
    const adminBackup: Record<string, unknown> | null = abSnap && abSnap.exists() ? abSnap.data() : null;

    const vaultData: Record<string, unknown> = {};
    shardSnaps.forEach((snap) => {
      if (snap && snap.exists()) {
        const d = snap.data();
        if (typeof d.payloadJson === 'string' && d.payloadJson.length >= 2) {
          try {
            Object.assign(vaultData, JSON.parse(d.payloadJson));
          } catch {
            /* ignore malformed shard */
          }
        }
      }
    });

    // Prefer rich backed-up Admin snapshot (especially recoverable lastGoodBackupJson if user cleared/deleted data)
    if (adminBackup) {
      try {
        const primaryJson = adminBackup.isDataDeleted
          ? String(adminBackup.lastGoodBackupJson || adminBackup.allUserDataJson || '{}')
          : String(adminBackup.allUserDataJson || adminBackup.lastGoodBackupJson || '{}');
        const parsedAb = JSON.parse(primaryJson);
        if (parsedAb && typeof parsedAb === 'object') {
          const curRecords = countWorkshopRecords(vaultData);
          const abRecords = countWorkshopRecords(parsedAb as Record<string, unknown>);
          if (adminBackup.isDataDeleted || curRecords === 0 || abRecords > curRecords) {
            const existingKyc = (vaultData.kyc && typeof vaultData.kyc === 'object' ? vaultData.kyc : {}) as Record<string, unknown>;
            const abKyc = (parsedAb.kyc && typeof parsedAb.kyc === 'object' ? parsedAb.kyc : {}) as Record<string, unknown>;
            Object.assign(vaultData, parsedAb);
            if (existingKyc.frontPhoto || existingKyc.backPhoto || existingKyc.selfiePhoto) {
              vaultData.kyc = {
                ...abKyc,
                frontPhoto: abKyc.frontPhoto || existingKyc.frontPhoto || '',
                backPhoto: abKyc.backPhoto || existingKyc.backPhoto || '',
                selfiePhoto: abKyc.selfiePhoto || existingKyc.selfiePhoto || ''
              };
            }
          }
        }
      } catch {
        /* ignore malformed backup json */
      }
    }

    const backups: Array<Record<string, unknown>> = backupsSnap ? backupsSnap.docs.map((d) => d.data()) : [];

    return { profile, vaultData, backups, adminBackup };
  },

  adminWatchUserLive(
    uid: string,
    onUpdate: (inspection: AdminUserInspection) => void,
    onError?: (err: unknown) => void
  ): () => void {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      return () => {};
    }
    let profile: Record<string, unknown> | null = null;
    let adminBackup: Record<string, unknown> | null = null;
    const shardMap: Record<string, Record<string, unknown>> = {};
    let backups: Array<Record<string, unknown>> = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const emitMerged = () => {
      if (closed) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (closed) return;
        const vaultData: Record<string, unknown> = {};
        for (const shardId of ['core', 'ledger', 'operations', 'kyc']) {
          if (shardMap[shardId]) {
            Object.assign(vaultData, shardMap[shardId]);
          }
        }
        if (adminBackup) {
          try {
            const primaryJson = adminBackup.isDataDeleted
              ? String(adminBackup.lastGoodBackupJson || adminBackup.allUserDataJson || '{}')
              : String(adminBackup.allUserDataJson || adminBackup.lastGoodBackupJson || '{}');
            const parsedAb = JSON.parse(primaryJson);
            if (parsedAb && typeof parsedAb === 'object') {
              const curRecords = countWorkshopRecords(vaultData);
              if (adminBackup.isDataDeleted || curRecords === 0) {
                const existingKyc = (vaultData.kyc && typeof vaultData.kyc === 'object' ? vaultData.kyc : {}) as Record<string, unknown>;
                const abKyc = (parsedAb.kyc && typeof parsedAb.kyc === 'object' ? parsedAb.kyc : {}) as Record<string, unknown>;
                Object.assign(vaultData, parsedAb);
                if (existingKyc.frontPhoto || existingKyc.backPhoto || existingKyc.selfiePhoto) {
                  vaultData.kyc = {
                    ...abKyc,
                    frontPhoto: abKyc.frontPhoto || existingKyc.frontPhoto || '',
                    backPhoto: abKyc.backPhoto || existingKyc.backPhoto || '',
                    selfiePhoto: abKyc.selfiePhoto || existingKyc.selfiePhoto || ''
                  };
                }
              }
            }
          } catch {
            /* ignore */
          }
        }
        onUpdate({ profile, vaultData, backups, adminBackup });
      }, 80);
    };

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        profile = snap.exists() ? snap.data() : null;
        emitMerged();
      },
      (err) => { if (onError) onError(err); }
    );

    const unsubBackup = onSnapshot(
      doc(db, 'adminBackups', uid),
      (snap) => {
        adminBackup = snap.exists() ? snap.data() : null;
        emitMerged();
      },
      (err) => { if (onError) onError(err); }
    );

    const unsubVault = onSnapshot(
      collection(db, 'users', uid, 'vault'),
      (snaps) => {
        snaps.docs.forEach((d) => {
          const data = d.data();
          const docId = String(data.docType || d.id);
          if (typeof data.payloadJson === 'string' && data.payloadJson.length >= 2) {
            try {
              shardMap[docId] = JSON.parse(data.payloadJson) as Record<string, unknown>;
            } catch {
              /* ignore */
            }
          }
        });
        emitMerged();
      },
      (err) => { if (onError) onError(err); }
    );

    getDocs(query(collection(db, 'users', uid, 'backups'), orderBy('createdAt', 'desc'), limit(10)))
      .then((snaps) => {
        backups = snaps.docs.map((d) => d.data());
        emitMerged();
      })
      .catch(() => {});

    return () => {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubProfile();
      unsubBackup();
      unsubVault();
    };
  },

  async adminSaveUserAndCustomerData(
    uid: string,
    profileUpdates: {
      name?: string;
      mobile?: string;
      email?: string;
    },
    vaultUpdates: Record<string, unknown>,
    detailMessage = 'Admin updated user/customer data.'
  ): Promise<{ updatedAt: number; recordCount: number }> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    const adminActor = String(auth.currentUser.email || ADMIN_EMAIL);
    const now = Date.now();

    const current = await this.adminLoadUserInspection(uid);
    const existingProfile = current.profile || {};
    const existingBackup = current.adminBackup || {};

    const mergedRaw = {
      ...current.vaultData,
      ...vaultUpdates
    };
    const normalized = buildAdminSnapshotObject(mergedRaw);
    const recordCount = countWorkshopRecords(normalized);
    const prevGoodJson = String(existingBackup.lastGoodBackupJson || '');

    const corePayload = {
      settings: normalized.settings || {},
      customers: normalized.customers || [],
      orders: normalized.orders || [],
      customerPayments: normalized.customerPayments || []
    };
    const ledgerPayload = {
      transactions: normalized.transactions || [],
      suppliers: normalized.suppliers || [],
      supplierEntries: normalized.supplierEntries || [],
      partyPayments: normalized.partyPayments || []
    };
    const opsPayload = {
      stock: normalized.stock || [],
      staff: normalized.staff || [],
      staffLogs: normalized.staffLogs || [],
      salaryHistory: normalized.salaryHistory || [],
      messEntries: normalized.messEntries || [],
      rentRecords: normalized.rentRecords || [],
      rentPayments: normalized.rentPayments || [],
      committees: normalized.committees || [],
      archivedReports: normalized.archivedReports || [],
      lastActiveMonth: normalized.lastActiveMonth || ''
    };
    const rawKyc = (normalized.kyc && typeof normalized.kyc === 'object' ? normalized.kyc : {}) as Record<string, unknown>;
    let kycJson = JSON.stringify({ kyc: rawKyc });
    if (kycJson.length > VAULT_MAX_BYTES) {
      kycJson = JSON.stringify({
        kyc: { ...rawKyc, frontPhoto: '', backPhoto: '', selfiePhoto: '' }
      });
    }

    const shards: Array<{ id: 'core' | 'ledger' | 'operations' | 'kyc'; payloadJson: string }> = [
      { id: 'core', payloadJson: safeStringifyBounded(corePayload) },
      { id: 'ledger', payloadJson: safeStringifyBounded(ledgerPayload) },
      { id: 'operations', payloadJson: safeStringifyBounded(opsPayload) },
      { id: 'kyc', payloadJson: kycJson }
    ];

    for (const shard of shards) {
      await setDoc(doc(db, 'users', uid, 'vault', shard.id), {
        uid,
        docType: shard.id,
        payloadJson: shard.payloadJson,
        updatedAt: now
      });
    }

    const userName = String(profileUpdates.name ?? existingProfile.name ?? existingBackup.name ?? 'Workshop User').trim().slice(0, 120) || 'Workshop User';
    const userMobile = String(profileUpdates.mobile ?? existingProfile.mobile ?? existingBackup.phone ?? '').trim().slice(0, 40);
    const userEmail = String(profileUpdates.email ?? existingProfile.email ?? existingBackup.email ?? '').trim().slice(0, 160);
    const summary = computeSummaryStats(normalized);

    const updatedProfile: Record<string, unknown> = {
      ...existingProfile,
      uid,
      name: userName,
      mobile: userMobile,
      email: userEmail,
      totalKhataAmount: summary.totalKhataAmount,
      totalPendingAmount: summary.totalPendingAmount,
      customerCount: summary.customerCount,
      lastSyncAt: now,
      lastAdminRestoreAt: now,
      createdAt: Number(existingProfile.createdAt || existingBackup.updatedAt || now),
      updatedAt: now
    };
    await setDoc(doc(db, 'users', uid), updatedProfile);

    const snapJson = safeAdminBackupJson(normalized);
    const preserveGoodJson = recordCount > 0 ? snapJson : (prevGoodJson.length > 2 ? prevGoodJson : snapJson);
    await setDoc(doc(db, 'adminBackups', uid), {
      ...existingBackup,
      uid,
      userId: uid,
      name: userName,
      profilePicUrl: String(existingBackup.profilePicUrl || existingProfile.profilePicUrl || '').slice(0, PROFILE_PIC_MAX),
      phone: userMobile,
      email: userEmail,
      termsAccepted: Boolean(existingBackup.termsAccepted ?? existingProfile.termsAccepted ?? true),
      termsAcceptedAt: Number(existingBackup.termsAcceptedAt ?? existingProfile.termsAcceptedAt ?? now),
      recordCount,
      isDataDeleted: false,
      deletedAt: 0,
      allUserDataJson: snapJson,
      lastGoodBackupJson: preserveGoodJson,
      lastBackupAt: now,
      lastRestoredAt: now,
      lastRestoredBy: adminActor.slice(0, 160),
      updatedAt: now
    });

    await this.appendAdminActivityLog({
      uid,
      userName,
      action: 'RESTORE_USER_DATA',
      performedBy: adminActor,
      performedByRole: 'admin',
      details: String(detailMessage || 'Admin updated user data.').slice(0, 300)
    });

    return { updatedAt: now, recordCount };
  },

  async adminDeleteUserData(uid: string): Promise<{ deletedAt: number; userName: string }> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    const adminActor = String(auth.currentUser.email || ADMIN_EMAIL);
    const now = Date.now();
    const current = await this.adminLoadUserInspection(uid);
    const existingProfile = current.profile || {};
    const existingBackup = current.adminBackup || {};

    const prevSnap = buildAdminSnapshotObject(current.vaultData);
    const prevGoodJson = safeAdminBackupJson(prevSnap);
    const keepGoodJson = prevGoodJson.length > 2
      ? prevGoodJson
      : String(existingBackup.lastGoodBackupJson || '{}');

    const emptyData = buildAdminSnapshotObject({
      settings: prevSnap.settings || {},
      kyc: prevSnap.kyc || {}
    });

    const shards: Array<{ id: 'core' | 'ledger' | 'operations'; payloadJson: string }> = [
      { id: 'core', payloadJson: safeStringifyBounded({ settings: emptyData.settings, customers: [], orders: [], customerPayments: [] }) },
      { id: 'ledger', payloadJson: safeStringifyBounded({ transactions: [], suppliers: [], supplierEntries: [], partyPayments: [] }) },
      { id: 'operations', payloadJson: safeStringifyBounded({ stock: [], staff: [], staffLogs: [], salaryHistory: [], messEntries: [], rentRecords: [], rentPayments: [], committees: [], archivedReports: [], lastActiveMonth: '' }) }
    ];
    for (const shard of shards) {
      await setDoc(doc(db, 'users', uid, 'vault', shard.id), {
        uid,
        docType: shard.id,
        payloadJson: shard.payloadJson,
        updatedAt: now
      });
    }

    const userName = String(existingProfile.name || existingBackup.name || 'Workshop User').slice(0, 120);
    await setDoc(doc(db, 'users', uid), {
      ...existingProfile,
      uid,
      name: userName,
      totalKhataAmount: 0,
      totalPendingAmount: 0,
      customerCount: 0,
      lastSyncAt: now,
      lastAdminRestoreAt: now,
      createdAt: Number(existingProfile.createdAt || existingBackup.updatedAt || now),
      updatedAt: now
    });

    await setDoc(doc(db, 'adminBackups', uid), {
      ...existingBackup,
      uid,
      userId: uid,
      name: userName,
      profilePicUrl: String(existingBackup.profilePicUrl || existingProfile.profilePicUrl || '').slice(0, PROFILE_PIC_MAX),
      phone: String(existingBackup.phone || existingProfile.mobile || '').slice(0, 40),
      email: String(existingBackup.email || existingProfile.email || '').slice(0, 160),
      termsAccepted: Boolean(existingBackup.termsAccepted ?? existingProfile.termsAccepted ?? true),
      termsAcceptedAt: Number(existingBackup.termsAcceptedAt ?? existingProfile.termsAcceptedAt ?? now),
      recordCount: 0,
      isDataDeleted: true,
      deletedAt: now,
      allUserDataJson: safeAdminBackupJson(emptyData),
      lastGoodBackupJson: keepGoodJson,
      lastBackupAt: now,
      lastRestoredAt: Number(existingBackup.lastRestoredAt || 0),
      lastRestoredBy: String(existingBackup.lastRestoredBy || ''),
      updatedAt: now
    });

    await this.appendAdminActivityLog({
      uid,
      userName,
      action: 'DATA_CLEARED',
      performedBy: adminActor,
      performedByRole: 'admin',
      details: `Admin deleted workshop data (${countWorkshopRecords(prevSnap)} records archived in lastGoodBackupJson for restore).`
    });

    return { deletedAt: now, userName };
  },

  async adminRestoreUserBackup(uid: string): Promise<{ restoredAt: number; recordCount: number; userName: string }> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    const adminActor = String(auth.currentUser.email || ADMIN_EMAIL);
    const now = Date.now();

    let existingProfile: Record<string, unknown> | null = null;
    try {
      const pSnap = await getDoc(doc(db, 'users', uid));
      if (pSnap.exists()) existingProfile = pSnap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    }

    let adminBackup: Record<string, unknown> | null = null;
    try {
      const abSnap = await getDoc(doc(db, 'adminBackups', uid));
      if (abSnap.exists()) adminBackup = abSnap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `adminBackups/${uid}`);
    }

    let restoreData: Record<string, unknown> | null = null;
    if (adminBackup) {
      const candidateJson = String(adminBackup.lastGoodBackupJson || adminBackup.allUserDataJson || '');
      if (candidateJson.length > 2) {
        try {
          const parsed = JSON.parse(candidateJson);
          if (parsed && typeof parsed === 'object') {
            restoreData = parsed as Record<string, unknown>;
          }
        } catch { /* fallback below */ }
      }
    }

    // Fallback to latest /users/{uid}/backups snapshot if needed
    if (!restoreData || countWorkshopRecords(restoreData) === 0) {
      try {
        const bq = query(collection(db, 'users', uid, 'backups'), orderBy('createdAt', 'desc'), limit(5));
        const bSnaps = await getDocs(bq);
        for (const s of bSnaps.docs) {
          const p = JSON.parse(String(s.data()?.payloadJson || '{}'));
          const inner = (p?.data && typeof p.data === 'object' ? p.data : p) as Record<string, unknown>;
          if (inner && countWorkshopRecords(inner) > 0) {
            restoreData = inner;
            break;
          }
        }
      } catch { /* ignore */ }
    }

    if (!restoreData) {
      throw new Error('No backed-up data found to restore for this user.');
    }

    const normalized = buildAdminSnapshotObject(restoreData);
    const recordCount = countWorkshopRecords(normalized);
    const userName = String(existingProfile?.name || adminBackup?.name || 'Workshop User').slice(0, 120);

    // 1. Write all 4 vault shards back to user's live Firestore vault (preserving user's account structure)
    const corePayload = {
      settings: normalized.settings || {},
      customers: normalized.customers || [],
      orders: normalized.orders || [],
      customerPayments: normalized.customerPayments || []
    };
    const ledgerPayload = {
      transactions: normalized.transactions || [],
      suppliers: normalized.suppliers || [],
      supplierEntries: normalized.supplierEntries || [],
      partyPayments: normalized.partyPayments || []
    };
    const opsPayload = {
      stock: normalized.stock || [],
      staff: normalized.staff || [],
      staffLogs: normalized.staffLogs || [],
      salaryHistory: normalized.salaryHistory || [],
      messEntries: normalized.messEntries || [],
      rentRecords: normalized.rentRecords || [],
      rentPayments: normalized.rentPayments || [],
      committees: normalized.committees || [],
      archivedReports: normalized.archivedReports || [],
      lastActiveMonth: normalized.lastActiveMonth || ''
    };
    const rawKyc = (normalized.kyc && typeof normalized.kyc === 'object' ? normalized.kyc : {}) as Record<string, unknown>;
    let kycJson = JSON.stringify({ kyc: rawKyc });
    if (kycJson.length > VAULT_MAX_BYTES) {
      kycJson = JSON.stringify({
        kyc: { ...rawKyc, frontPhoto: '', backPhoto: '', selfiePhoto: '' }
      });
    }

    const shards: Array<{ id: 'core' | 'ledger' | 'operations' | 'kyc'; payloadJson: string }> = [
      { id: 'core', payloadJson: safeStringifyBounded(corePayload) },
      { id: 'ledger', payloadJson: safeStringifyBounded(ledgerPayload) },
      { id: 'operations', payloadJson: safeStringifyBounded(opsPayload) },
      { id: 'kyc', payloadJson: kycJson }
    ];

    for (const shard of shards) {
      await setDoc(doc(db, 'users', uid, 'vault', shard.id), {
        uid,
        docType: shard.id,
        payloadJson: shard.payloadJson,
        updatedAt: now
      });
    }

    // 2. Update /users/{uid} summary + lastAdminRestoreAt trigger (preserve device session fields!)
    const summary = computeSummaryStats(normalized);
    const updatedProfile = {
      ...(existingProfile || {}),
      uid,
      name: userName,
      email: String(existingProfile?.email || adminBackup?.email || '').slice(0, 160),
      mobile: String(existingProfile?.mobile || adminBackup?.phone || '').slice(0, 40),
      totalKhataAmount: summary.totalKhataAmount,
      totalPendingAmount: summary.totalPendingAmount,
      customerCount: summary.customerCount,
      lastSyncAt: now,
      lastBackupAt: now,
      lastAdminRestoreAt: now,
      createdAt: Number(existingProfile?.createdAt || adminBackup?.updatedAt || now),
      updatedAt: now
    };
    await setDoc(doc(db, 'users', uid), updatedProfile);

    // 3. Update /adminBackups/{uid} to mark restored and clear isDataDeleted flag
    const restoredJson = safeAdminBackupJson(normalized);
    await setDoc(doc(db, 'adminBackups', uid), {
      ...(adminBackup || {}),
      uid,
      userId: uid,
      name: userName,
      profilePicUrl: String(adminBackup?.profilePicUrl || existingProfile?.profilePicUrl || '').slice(0, PROFILE_PIC_MAX),
      phone: String(adminBackup?.phone || existingProfile?.mobile || '').slice(0, 40),
      email: String(adminBackup?.email || existingProfile?.email || '').slice(0, 160),
      termsAccepted: Boolean(adminBackup?.termsAccepted ?? existingProfile?.termsAccepted ?? true),
      termsAcceptedAt: Number(adminBackup?.termsAcceptedAt ?? existingProfile?.termsAcceptedAt ?? now),
      recordCount,
      isDataDeleted: false,
      deletedAt: 0,
      allUserDataJson: restoredJson,
      lastGoodBackupJson: restoredJson,
      lastBackupAt: now,
      lastRestoredAt: now,
      lastRestoredBy: adminActor.slice(0, 160),
      updatedAt: now
    });

    // 4. Write Admin Activity Log entry with Restored By Admin, Date & Time
    await this.appendAdminActivityLog({
      uid,
      userName,
      action: 'RESTORE_USER_DATA',
      performedBy: adminActor,
      performedByRole: 'admin',
      details: `Restored By Admin (${adminActor}) — ${recordCount} records restored to user account.`
    });

    return { restoredAt: now, recordCount, userName };
  },

  async adminListActivityLogs(): Promise<Array<Record<string, unknown>>> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    const path = 'adminActivityLogs';
    try {
      const q = query(collection(db, 'adminActivityLogs'), orderBy('createdAt', 'desc'), limit(150));
      const snaps = await getDocs(q);
      return snaps.docs.map((d) => d.data());
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },

  async adminUpdateUserStatus(
    uid: string,
    updates: {
      blocked?: boolean;
      kycStatus?: 'none' | 'verifying' | 'approved' | 'duplicate';
      kycDuplicateOf?: string;
    }
  ): Promise<void> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    const now = Date.now();
    const userPath = `users/${uid}`;
    let existingData: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) throw new Error('User not found.');
      existingData = snap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, userPath);
    }

    const nextBlocked = updates.blocked !== undefined ? Boolean(updates.blocked) : Boolean(existingData?.blocked ?? false);
    const nextKycStatus = updates.kycStatus ?? (String(existingData?.kycStatus || 'none') as 'none' | 'verifying' | 'approved' | 'duplicate');
    const nextDupOf = updates.kycDuplicateOf !== undefined
      ? String(updates.kycDuplicateOf).slice(0, 128)
      : (nextKycStatus === 'approved' ? '' : String(existingData?.kycDuplicateOf || '').slice(0, 128));

    const updatedProfile = {
      ...existingData,
      uid,
      blocked: nextBlocked,
      kycStatus: nextKycStatus,
      kycDuplicateOf: nextDupOf,
      updatedAt: now
    };

    try {
      await setDoc(doc(db, 'users', uid), updatedProfile);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }

    // Keep user's vault/kyc shard aligned
    if (updates.kycStatus !== undefined) {
      const kycPath = `users/${uid}/vault/kyc`;
      try {
        const kycSnap = await getDoc(doc(db, 'users', uid, 'vault', 'kyc'));
        const existingKycObj = kycSnap.exists()
          ? (JSON.parse(String(kycSnap.data()?.payloadJson || '{}')).kyc || {})
          : {};
        const mergedKyc = {
          ...existingKycObj,
          status: nextKycStatus,
          verifiedAt: nextKycStatus === 'approved' ? (existingKycObj.verifiedAt || now) : 0,
          duplicateOf: nextDupOf
        };
        await setDoc(doc(db, 'users', uid, 'vault', 'kyc'), {
          uid,
          docType: 'kyc',
          payloadJson: JSON.stringify({ kyc: mergedKyc }),
          updatedAt: now
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, kycPath);
      }

      // Claim cnicRegistry if Admin manually approves an unclaimed or reassigned CNIC
      if (nextKycStatus === 'approved' && typeof existingData?.cnicHash === 'string' && existingData.cnicHash.length === 64) {
        const cHash = existingData.cnicHash;
        try {
          const cRef = doc(db, 'cnicRegistry', cHash);
          const cSnap = await getDoc(cRef);
          if (!cSnap.exists()) {
            await setDoc(cRef, { cnicHash: cHash, uid, createdAt: now });
          } else if (String(cSnap.data()?.uid || '') !== uid) {
            await setDoc(cRef, { cnicHash: cHash, uid, createdAt: Number(cSnap.data()?.createdAt || now) });
          }
        } catch {
          /* ignore non-critical claim sync */
        }
      }
    }
  }
};
