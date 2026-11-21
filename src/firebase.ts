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

export function normalizeIdentifier(rawInput: string): {
  authType: 'email' | 'mobile';
  authEmail: string;
  email: string;
  mobile: string;
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
      identifier: email
    };
  }
  let digits = clean.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw new Error('Enter a valid Email or Mobile Number (e.g. 03001234567).');
  }
  if (digits.startsWith('0') && digits.length === 11) {
    digits = '92' + digits.slice(1);
  }
  return {
    authType: 'mobile',
    authEmail: `m_${digits}@mobile.digitalkhata.app`,
    email: '',
    mobile: clean,
    identifier: clean
  };
}

const VAULT_MAX_BYTES = 880000;

function safeStringifyBounded(obj: Record<string, unknown>): string {
  const s = JSON.stringify(obj);
  if (s.length <= VAULT_MAX_BYTES) return s;
  // Clone shallowly and compact heavy optional arrays/blobs cleanly instead of corrupting JSON
  const clone: Record<string, unknown> = { ...obj };
  if (Array.isArray(clone.archivedReports) && clone.archivedReports.length > 24) {
    clone.archivedReports = clone.archivedReports.slice(-24);
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
  const clean = String(rawCnic || '').trim();
  if (!/^\d{13}$/.test(clean)) {
    throw new Error('CNIC sirf 13 digits ka hona chahiye (bina dash ke, e.g. 3520212345671).');
  }
  return clean;
}

export async function hashCnic(cnic13: string): Promise<string> {
  const clean = normalizeCnic13(cnic13);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dk_cnic_v1:${clean}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function claimCnicForUser(cnic13: string, uid: string): Promise<string> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Please sign in first.');
  }
  const cnicHash = await hashCnic(cnic13);
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
    throw new Error('Is CNIC par pehle se account bana hua hai');
  }
  try {
    await setDoc(ref, {
      cnicHash,
      uid,
      createdAt: Date.now()
    });
    return cnicHash;
  } catch {
    // Re-check whether concurrent claim succeeded by another user
    const check = await getDoc(ref).catch(() => null);
    if (check && check.exists() && String(check.data()?.uid || '') === uid) {
      return cnicHash;
    }
    throw new Error('Is CNIC par pehle se account bana hua hai');
  }
}

export interface CloudUserBundle {
  profile: Record<string, unknown> | null;
  vaultData: Record<string, unknown>;
  hasCloudData: boolean;
  latestBackup: Record<string, unknown> | null;
}

export const dkCloud = {
  auth,
  db,
  testConnection,
  normalizeIdentifier,
  normalizeCnic13,
  hashCnic,
  claimCnicForUser,

  onAuthChange(cb: (user: User | null) => void) {
    return onAuthStateChanged(auth, cb);
  },

  async signUp(name: string, identifier: string, password: string, cnic13?: string) {
    const cleanName = String(name || '').trim().slice(0, 120);
    if (!cleanName) throw new Error('Full Name is required.');
    const validCnic = cnic13 !== undefined && cnic13 !== '' ? normalizeCnic13(cnic13) : '';
    const norm = normalizeIdentifier(identifier);
    const cred = await createUserWithEmailAndPassword(auth, norm.authEmail, password);

    if (validCnic) {
      try {
        await claimCnicForUser(validCnic, cred.user.uid);
      } catch (cnicErr) {
        try {
          await deleteUser(cred.user);
        } catch {
          try { await signOut(auth); } catch { /* ignore */ }
        }
        throw cnicErr;
      }
    }

    await updateProfile(cred.user, { displayName: cleanName });
    const now = Date.now();
    const profileDoc = {
      uid: cred.user.uid,
      name: cleanName,
      identifier: norm.identifier.slice(0, 160),
      email: norm.email.slice(0, 160),
      mobile: norm.mobile.slice(0, 40),
      authType: norm.authType,
      pinEnabled: false,
      pinHash: '',
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

    const profileDoc = {
      uid,
      name: String(meta.name || existingData?.name || 'Workshop Owner').slice(0, 120),
      identifier: String(meta.identifier ?? existingData?.identifier ?? '').slice(0, 160),
      email: String(meta.email ?? existingData?.email ?? '').slice(0, 160),
      mobile: String(meta.mobile ?? existingData?.mobile ?? '').slice(0, 40),
      authType: meta.authType === 'mobile' || existingData?.authType === 'mobile' ? 'mobile' : 'email',
      pinEnabled: Boolean(meta.pinEnabled ?? existingData?.pinEnabled ?? false),
      pinHash: String(meta.pinHash ?? existingData?.pinHash ?? '').slice(0, 128),
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
      messEntries: appState.messEntries || [],
      rentRecords: appState.rentRecords || [],
      rentPayments: appState.rentPayments || [],
      committees: appState.committees || [],
      archivedReports: appState.archivedReports || [],
      lastActiveMonth: appState.lastActiveMonth || ''
    };

    const rawKyc = (appState.kyc as Record<string, unknown>) || {};
    let kycJson = JSON.stringify({ kyc: rawKyc });
    if (kycJson.length > VAULT_MAX_BYTES) {
      // Keep KYC status/metadata safely under Firestore 1MB cap if photos were huge
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
  }
};
