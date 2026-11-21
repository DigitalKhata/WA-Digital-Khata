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
  type User
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  type Firestore
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

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
      })
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = dbInstance;
export const auth = getAuth(app);

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
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
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

  async signUp(name: string, identifier: string, password: string, cnic?: string, extraMobile?: string) {
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
      totalKhataAmount: 0,
      totalPendingAmount: 0,
      customerCount: 0,
      lastSyncAt: now,
      lastBackupAt: 0,
      createdAt: now,
      updatedAt: now
    };
    const userPath = `users/${cred.user.uid}`;
    try {
      await setDoc(doc(db, 'users', cred.user.uid), profileDoc);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
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

  async loadUserBundle(uid: string): Promise<CloudUserBundle> {
    const emptyBundle: CloudUserBundle = { profile: null, vaultData: {}, hasCloudData: false, latestBackup: null };
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
      if (!auth.currentUser || auth.currentUser.uid !== uid) return emptyBundle;
      handleFirestoreError(err, OperationType.LIST, backupsPath);
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

    const mobileStr = String(meta.mobile ?? existingData?.mobile ?? '').slice(0, 40);
    let mobileHashToSave = String(meta.mobileHash ?? existingData?.mobileHash ?? '').slice(0, 64);
    if (!mobileHashToSave && mobileStr && normalizeMobileDigits(mobileStr).length >= 8) {
      try {
        mobileHashToSave = await hashMobile(mobileStr);
      } catch { /* ignore */ }
    }

    const profileDoc = {
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
      totalKhataAmount: summary.totalKhataAmount,
      totalPendingAmount: summary.totalPendingAmount,
      customerCount: summary.customerCount,
      lastSyncAt: now,
      lastBackupAt: Number(meta.lastBackupAt ?? existingData?.lastBackupAt ?? 0),
      createdAt: Number(existingData?.createdAt ?? meta.createdAt ?? now),
      updatedAt: now
    };

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

    return now;
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
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        await setDoc(doc(db, 'users', uid), {
          ...snap.data(),
          lastBackupAt: now,
          updatedAt: now
        });
      }
    } catch (err) {
      if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error('AUTH_SESSION_CHANGED');
      handleFirestoreError(err, OperationType.UPDATE, userPath);
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

  // ---------------- ADMIN PANEL OPERATIONS ----------------
  async adminListAllUsers(): Promise<Array<Record<string, unknown>>> {
    if (!auth.currentUser || !isAdminEmail(auth.currentUser.email)) {
      throw new Error('Admin authorization required.');
    }
    try {
      const snaps = await getDocs(collection(db, 'users'));
      const list = snaps.docs.map((d) => d.data());
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
    let profile: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) profile = snap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    }

    const vaultData: Record<string, unknown> = {};
    for (const shardId of ['core', 'ledger', 'operations', 'kyc'] as const) {
      try {
        const snap = await getDoc(doc(db, 'users', uid, 'vault', shardId));
        if (snap.exists()) {
          const d = snap.data();
          if (typeof d.payloadJson === 'string' && d.payloadJson.length >= 2) {
            Object.assign(vaultData, JSON.parse(d.payloadJson));
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${uid}/vault/${shardId}`);
      }
    }

    const backups: Array<Record<string, unknown>> = [];
    try {
      const q = query(collection(db, 'users', uid, 'backups'), orderBy('createdAt', 'desc'), limit(10));
      const snaps = await getDocs(q);
      snaps.docs.forEach((d) => backups.push(d.data()));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/backups`);
    }

    return { profile, vaultData, backups };
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
