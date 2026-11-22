import './index.css';
import { dkCloud } from './firebase';
import { dkDrive } from './driveBackup';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

declare global {
  interface Window {
    __DK_CLOUD__?: typeof dkCloud;
    __DK_DRIVE__?: typeof dkDrive;
    __DK_INVOICE_LIBS__?: {
      jsPDF: typeof jsPDF;
      QRCode: typeof QRCode;
    };
  }
}

window.__DK_CLOUD__ = dkCloud;
window.__DK_DRIVE__ = dkDrive;
window.__DK_INVOICE_LIBS__ = { jsPDF, QRCode };
void dkCloud.testConnection();
window.dispatchEvent(new CustomEvent('dk-cloud-ready'));
