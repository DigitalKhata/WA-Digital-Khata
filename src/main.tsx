import './index.css';
import { dkCloud } from './firebase';

declare global {
  interface Window {
    __DK_CLOUD__?: typeof dkCloud;
  }
}

window.__DK_CLOUD__ = dkCloud;
void dkCloud.testConnection();
window.dispatchEvent(new CustomEvent('dk-cloud-ready'));
