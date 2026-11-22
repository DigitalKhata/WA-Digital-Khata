import './index.css';
import { dkCloud } from './firebase';
import { dkDrive } from './driveBackup';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface DkPwaController {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  install: () => Promise<boolean>;
}

declare global {
  interface Window {
    __DK_CLOUD__?: typeof dkCloud;
    __DK_DRIVE__?: typeof dkDrive;
    __DK_INVOICE_LIBS__?: {
      jsPDF: typeof jsPDF;
      QRCode: typeof QRCode;
    };
    __DK_PWA__?: DkPwaController;
  }
}

registerSW({ immediate: true });

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const isStandaloneMode =
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;
const isIOSDevice = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());

const pwaController: DkPwaController = {
  isInstallable: false,
  isInstalled: isStandaloneMode,
  isIOS: isIOSDevice,
  install: async () => {
    if (!deferredInstallPrompt) return false;
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      pwaController.isInstalled = true;
      pwaController.isInstallable = false;
      deferredInstallPrompt = null;
      window.dispatchEvent(new CustomEvent('dk-pwa-state'));
      return true;
    }
    return false;
  },
};

window.__DK_PWA__ = pwaController;

window.addEventListener('beforeinstallprompt', (e: Event) => {
  e.preventDefault();
  deferredInstallPrompt = e as BeforeInstallPromptEvent;
  pwaController.isInstallable = true;
  window.dispatchEvent(new CustomEvent('dk-pwa-state'));
});

window.addEventListener('appinstalled', () => {
  pwaController.isInstalled = true;
  pwaController.isInstallable = false;
  deferredInstallPrompt = null;
  window.dispatchEvent(new CustomEvent('dk-pwa-state'));
});

window.__DK_CLOUD__ = dkCloud;
window.__DK_DRIVE__ = dkDrive;
window.__DK_INVOICE_LIBS__ = { jsPDF, QRCode };
void dkCloud.testConnection();
window.dispatchEvent(new CustomEvent('dk-cloud-ready'));
