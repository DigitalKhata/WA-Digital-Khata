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
let currentDriveUser: { email: string; name: string; photo: string } | null = null;

function notifyDriveState() {
  window.dispatchEvent(new CustomEvent('dk-drive-state'));
}

void getRedirectResult(driveAuth)
  .then((result) => {
    if (!result) return;
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
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
    if (!cachedAccessToken && !isSigningIn) {
      cachedAccessToken = null;
    }
  } else {
    cachedAccessToken = null;
    currentDriveUser = null;
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

  isConnected(): boolean {
    return Boolean(cachedAccessToken);
  },

  getUser(): { email: string; name: string; photo: string } | null {
    return currentDriveUser;
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
        throw new Error('Google Drive access token nahi mila. Dobara try karein.');
      }
      cachedAccessToken = credential.accessToken;
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
    await signOut(driveAuth);
    notifyDriveState();
  },

  async findLatestBackup(): Promise<DriveBackupFileInfo | null> {
    if (!cachedAccessToken) {
      throw new Error('DRIVE_AUTH_REQUIRED');
    }
    const q = `name='${BACKUP_FILE_NAME}' and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=5`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cachedAccessToken}` }
    });
    if (res.status === 401) {
      cachedAccessToken = null;
      notifyDriveState();
      throw new Error('DRIVE_AUTH_EXPIRED');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || 'Google Drive file list fetch failed.');
    }
    const json = (await res.json()) as { files?: DriveBackupFileInfo[] };
    if (json.files && json.files.length > 0) {
      return json.files[0];
    }

    // Fallback: look for any DigitalKhata JSON backup created by this app
    const qAny = `name contains 'DigitalKhata' and mimeType='application/json' and trashed=false`;
    const urlAny = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qAny)}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=5`;
    const resAny = await fetch(urlAny, {
      headers: { Authorization: `Bearer ${cachedAccessToken}` }
    });
    if (resAny.ok) {
      const jAny = (await resAny.json()) as { files?: DriveBackupFileInfo[] };
      if (jAny.files && jAny.files.length > 0) {
        return jAny.files[0];
      }
    }
    return null;
  },

  async uploadBackup(
    payloadObj: Record<string, unknown>,
    existingFileId?: string
  ): Promise<DriveBackupFileInfo> {
    if (!cachedAccessToken) {
      throw new Error('DRIVE_AUTH_REQUIRED');
    }
    const metadata = {
      name: BACKUP_FILE_NAME,
      mimeType: 'application/json'
    };
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
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,modifiedTime`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime`;

    const res = await fetch(endpoint, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${cachedAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
    if (res.status === 401) {
      cachedAccessToken = null;
      notifyDriveState();
      throw new Error('DRIVE_AUTH_EXPIRED');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || 'Google Drive upload failed.');
    }
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
    if (res.status === 401) {
      cachedAccessToken = null;
      notifyDriveState();
      throw new Error('DRIVE_AUTH_EXPIRED');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || 'Google Drive download failed.');
    }
    return (await res.json()) as Record<string, unknown>;
  }
};
