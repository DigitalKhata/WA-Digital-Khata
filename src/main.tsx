import './index.css';
import { dkCloud } from './firebase';
import { dkDrive } from './driveBackup';

declare global {
  interface Window {
    __DK_CLOUD__?: typeof dkCloud;
    __DK_DRIVE__?: typeof dkDrive;
  }
}

window.__DK_CLOUD__ = dkCloud;
window.__DK_DRIVE__ = dkDrive;
void dkCloud.testConnection();
window.dispatchEvent(new CustomEvent('dk-cloud-ready'));
