import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  type User
} from 'firebase/auth';
import { firebaseConfig } from './firebase';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
const useSelfHostedAuth =
  String(envMeta.VITE_FIREBASE_SELF_HOSTED_AUTH || '').trim() === 'true' &&
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  !window.location.hostname.endsWith('.firebaseapp.com') &&
  !window.location.hostname.endsWith('.web.app');

const DRIVE_FIREBASE_CONFIG = {
  ...firebaseConfig,
  ...(useSelfHostedAuth && typeof window !== 'undefined' ? { authDomain: window.location.host } : {})
};

const DRIVE_FOLDER_NAME = 'Warsha Aluminium Backup';
const BACKUP_FILE_NAME = 'DigitalKhata_Warsha_Backup.json';

const driveApp =
  getApps().find((a) => a.name === 'google-drive-oauth') ||
  initializeApp(DRIVE_FIREBASE_CONFIG, 'google-drive-oauth');

const driveAuth = getAuth(driveApp);
const driveProvider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  driveProvider.addScope(scope);
}
driveProvider.setCustomParameters({ prompt: 'select_account' });

// In-memory access token cache ONLY (never stored in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;
let scopeMissing = false;
let cachedFolderId: string | null = null;
let currentDriveUser: { email: string; name: string; photo: string } | null = null;

function notifyDriveState() {
  window.dispatchEvent(new CustomEvent('dk-drive-state'));
}

function buildDatedBackupFilename(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `DigitalKhata_Backup_${yyyy}-${mm}-${dd}_${hh}-${min}.json`;
}

async function handleDriveHttpError(res: Response, fallbackMsg: string): Promise<never> {
  if (res.status === 401) {
    cachedAccessToken = null;
    notifyDriveState();
    throw new Error('DRIVE_AUTH_EXPIRED');
  }
  const txt = await res.text().catch(() => '');
  if (res.status === 403 || txt.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || txt.includes('insufficientPermissions')) {
    scopeMissing = true;
    notifyDriveState();
    throw new Error('DRIVE_SCOPE_MISSING');
  }
  throw new Error(txt || fallbackMsg);
}

void getRedirectResult(driveAuth)
  .then((result) => {
    if (!result) return;
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
      scopeMissing = false;
      currentDriveUser = {
        email: result.user.email || '',
        name: result.user.displayName || 'Google User',
        photo: result.user.photoURL || ''
      };
      notifyDriveState();
    }
  })
  .catch((err) => {
    console.warn('[Drive OAuth] redirect result error:', err?.code || err?.message || err);
  });

onAuthStateChanged(driveAuth, (user: User | null) => {
  if (user) {
    currentDriveUser = {
      email: user.email || '',
      name: user.displayName || 'Google User',
      photo: user.photoURL || ''
    };
  } else if (!cachedAccessToken && !isSigningIn) {
    currentDriveUser = null;
    cachedFolderId = null;
  }
  notifyDriveState();
});

export interface DriveBackupFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

export const dkDrive = {
  SCOPES,
  DRIVE_FOLDER_NAME,

  isConnected(): boolean {
    return Boolean(cachedAccessToken);
  },

  hasDriveScopeIssue(): boolean {
    return scopeMissing;
  },

  getUser(): { email: string; name: string; photo: string } | null {
    return currentDriveUser;
  },

  setSessionToken(
    token: string | null,
    user?: { email?: string; name?: string; photo?: string } | null,
    opts?: { scopeDenied?: boolean }
  ): void {
    cachedAccessToken = token || null;
    cachedFolderId = null;
    if (token) {
      scopeMissing = false;
    } else if (opts?.scopeDenied) {
      scopeMissing = true;
    }
    if (user && (user.email || user.name)) {
      currentDriveUser = {
        email: String(user.email || ''),
        name: String(user.name || 'Google User'),
        photo: String(user.photo || '')
      };
    } else if (!token && !driveAuth.currentUser) {
      currentDriveUser = null;
    }
    notifyDriveState();
  },

  async connectGoogleDrive(): Promise<{
    user: { email: string; name: string; photo: string };
    accessToken: string;
  }> {
    console.log(window.location.hostname);
    console.log(firebaseConfig.projectId);
    isSigningIn = true;
    try {
      const result = await signInWithPopup(driveAuth, driveProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        scopeMissing = true;
        notifyDriveState();
        throw new Error('DRIVE_SCOPE_MISSING');
      }
      cachedAccessToken = credential.accessToken;
      scopeMissing = false;
      cachedFolderId = null;
      currentDriveUser = {
        email: result.user.email || '',
        name: result.user.displayName || 'Google User',
        photo: result.user.photoURL || ''
      };
      notifyDriveState();
      return { user: currentDriveUser, accessToken: cachedAccessToken };
    } catch (err: unknown) {
      const code = String((err as { code?: string })?.code || '');
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(driveAuth, driveProvider);
      }
      if (code === 'auth/unauthorized-domain') {
        console.error('[Drive OAuth] auth/unauthorized-domain', {
          hostname: window.location.hostname,
          projectId: DRIVE_FIREBASE_CONFIG.projectId,
          authDomain: DRIVE_FIREBASE_CONFIG.authDomain
        });
      }
      throw err;
    } finally {
      isSigningIn = false;
    }
  },

  async disconnectGoogleDrive(): Promise<void> {
    cachedAccessToken = null;
    currentDriveUser = null;
    cachedFolderId = null;
    scopeMissing = false;
    await signOut(driveAuth);
    notifyDriveState();
  },

  async getOrCreateBackupFolder(): Promise<string> {
    if (!cachedAccessToken) {
      throw new Error('DRIVE_AUTH_REQUIRED');
    }
    if (cachedFolderId) return cachedFolderId;

    const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`;
    const findUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`;
    const findRes = await fetch(findUrl, {
      headers: { Authorization: `Bearer ${cachedAccessToken}` }
    });
    if (!findRes.ok) {
      await handleDriveHttpError(findRes, 'Could not query backup folder on Google Drive.');
    }
    const found = (await findRes.json()) as { files?: Array<{ id: string; name: string }> };
    if (found.files && found.files.length > 0) {
      cachedFolderId = found.files[0].id;
      return cachedFolderId;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cachedAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    if (!createRes.ok) {
      await handleDriveHttpError(createRes, 'Could not create Warsha Aluminium Backup folder on Google Drive.');
    }
    const created = (await createRes.json()) as { id: string };
    cachedFolderId = created.id;
    return cachedFolderId;
  },

  async listBackups(): Promise<DriveBackupFileInfo[]> {
    if (!cachedAccessToken) {
      throw new Error('DRIVE_AUTH_REQUIRED');
    }
    let folderId = '';
    try {
      folderId = await this.getOrCreateBackupFolder();
    } catch (e: unknown) {
      const msg = String((e as { message?: string })?.message || '');
      if (msg === 'DRIVE_AUTH_EXPIRED' || msg === 'DRIVE_SCOPE_MISSING') throw e;
    }

    const qParts = [
      `trashed=false`,
      `mimeType='application/json'`,
      folderId
        ? `('${folderId}' in parents or name contains 'DigitalKhata' or name='${BACKUP_FILE_NAME}')`
        : `(name contains 'DigitalKhata' or name='${BACKUP_FILE_NAME}')`
    ];
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qParts.join(' and '))}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=20`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cachedAccessToken}` }
    });
    if (!res.ok) {
      await handleDriveHttpError(res, 'Google Drive backup list fetch failed.');
    }
    const json = (await res.json()) as { files?: DriveBackupFileInfo[] };
    const files = Array.isArray(json.files) ? json.files : [];
    files.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
    scopeMissing = false;
    return files;
  },

  async findLatestBackup(): Promise<DriveBackupFileInfo | null> {
    const list = await this.listBackups();
    return list[0] || null;
  },

  async uploadBackup(
    payloadObj: Record<string, unknown>,
    existingFileId?: string,
    customFileName?: string
  ): Promise<DriveBackupFileInfo> {
    if (!cachedAccessToken) {
      throw new Error('DRIVE_AUTH_REQUIRED');
    }
    const folderId = existingFileId ? '' : await this.getOrCreateBackupFolder();
    const metadata: Record<string, unknown> = {
      name: customFileName || buildDatedBackupFilename(),
      mimeType: 'application/json'
    };
    if (folderId && !existingFileId) {
      metadata.parents = [folderId];
    }

    const boundary = 'dk_drive_boundary_' + Date.now().toString(36);
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(payloadObj)}\r\n` +
      `--${boundary}--`;

    const endpoint = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,modifiedTime,size`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size`;

    const res = await fetch(endpoint, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${cachedAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
    if (!res.ok) {
      await handleDriveHttpError(res, 'Google Drive upload failed.');
    }
    scopeMissing = false;
    return (await res.json()) as DriveBackupFileInfo;
  },

  async downloadBackup(fileId: string): Promise<Record<string, unknown>> {
    if (!cachedAccessToken) {
      throw new Error('DRIVE_AUTH_REQUIRED');
    }
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cachedAccessToken}` }
    });
    if (!res.ok) {
      await handleDriveHttpError(res, 'Google Drive download failed.');
    }
    scopeMissing = false;
    return (await res.json()) as Record<string, unknown>;
  }
};
