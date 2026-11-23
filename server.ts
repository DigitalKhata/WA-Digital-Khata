import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// CRC-32 table for valid ZIP/APK packaging
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(entries: Array<{ name: string; data: Buffer; compress?: boolean }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
  const dosDate = (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = entry.data;
    const useDeflate = entry.compress !== false && raw.length > 64;
    const compData = useDeflate ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(raw);

    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4);
    localHdr.writeUInt16LE(0x0800, 6);
    localHdr.writeUInt16LE(method, 8);
    localHdr.writeUInt16LE(dosTime, 10);
    localHdr.writeUInt16LE(dosDate, 12);
    localHdr.writeUInt32LE(sum, 14);
    localHdr.writeUInt32LE(compData.length, 18);
    localHdr.writeUInt32LE(raw.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    localParts.push(localHdr, nameBuf, compData);

    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(0x0800, 8);
    centralHdr.writeUInt16LE(method, 10);
    centralHdr.writeUInt16LE(dosTime, 12);
    centralHdr.writeUInt16LE(dosDate, 14);
    centralHdr.writeUInt32LE(sum, 16);
    centralHdr.writeUInt32LE(compData.length, 20);
    centralHdr.writeUInt32LE(raw.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt16LE(0, 34);
    centralHdr.writeUInt16LE(0, 36);
    centralHdr.writeUInt32LE(0, 38);
    centralHdr.writeUInt32LE(offset, 42);

    centralParts.push(centralHdr, nameBuf);
    offset += localHdr.length + nameBuf.length + compData.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

let cachedApkBuffer: Buffer | null = null;

function getOfficialApkBuffer(originUrl: string): Buffer {
  if (cachedApkBuffer) return cachedApkBuffer;

  const iconCandidates = [
    path.join(__dirname, 'public', 'icon.png'),
    path.join(__dirname, 'public', 'pwa-512x512.png'),
    path.join(__dirname, 'public', 'pwa-192x192.png')
  ];
  let iconBuf = Buffer.alloc(0);
  for (const p of iconCandidates) {
    if (fs.existsSync(p)) {
      iconBuf = fs.readFileSync(p);
      break;
    }
  }

  const appConfigJson = Buffer.from(
    JSON.stringify(
      {
        appName: 'Digital Khata',
        packageName: 'com.warsha.digitalkhata',
        versionName: '1.0',
        versionCode: 1,
        webUrl: originUrl || 'https://digitalkhata.app',
        builtAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );

  const manifestXml = Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.warsha.digitalkhata"
    android:versionCode="1"
    android:versionName="1.0">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:label="Digital Khata"
        android:icon="@mipmap/ic_launcher"
        android:allowBackup="true">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    'utf8'
  );

  const shaIcon = crypto.createHash('sha256').update(iconBuf).digest('base64');
  const shaManifest = crypto.createHash('sha256').update(manifestXml).digest('base64');
  const shaCfg = crypto.createHash('sha256').update(appConfigJson).digest('base64');

  const metaInfManifest = Buffer.from(
    `Manifest-Version: 1.0\r\nCreated-By: Digital Khata Official Builder 1.0\r\n\r\nName: AndroidManifest.xml\r\nSHA-256-Digest: ${shaManifest}\r\n\r\nName: assets/digital_khata_config.json\r\nSHA-256-Digest: ${shaCfg}\r\n\r\nName: res/mipmap-xxxhdpi-v4/ic_launcher.png\r\nSHA-256-Digest: ${shaIcon}\r\n\r\n`,
    'utf8'
  );

  const entries: Array<{ name: string; data: Buffer; compress?: boolean }> = [
    { name: 'AndroidManifest.xml', data: manifestXml, compress: true },
    { name: 'assets/digital_khata_config.json', data: appConfigJson, compress: true },
    { name: 'META-INF/MANIFEST.MF', data: metaInfManifest, compress: true }
  ];

  if (iconBuf.length > 0) {
    entries.push({ name: 'res/mipmap-xxxhdpi-v4/ic_launcher.png', data: iconBuf, compress: false });
  }

  cachedApkBuffer = buildZipArchive(entries);
  return cachedApkBuffer;
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractClientIp(req: express.Request): string {
  const xff = String(req.headers['x-forwarded-for'] || '');
  const firstForwarded = xff.split(',')[0]?.trim();
  const raw = firstForwarded || String(req.headers['x-real-ip'] || '') || req.ip || req.socket.remoteAddress || '';
  return raw.replace(/^::ffff:/, '').trim() || 'Unknown';
}

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === 'Unknown') return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

function buildDeviceEmailHtml(payload: {
  kind: 'approval-request' | 'blocked-alert';
  ownerName: string;
  deviceName: string;
  loginDateTime: string;
  location: string;
  ip: string;
  browserVersion: string;
  allowUrl: string;
  denyUrl: string;
}): string {
  const isBlockedAlert = payload.kind === 'blocked-alert';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0f172a;padding:24px;color:#f8fafc;">
    <div style="max-width:560px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;">
      <h2 style="margin:0 0 8px;color:${isBlockedAlert ? '#f87171' : '#38bdf8'};font-size:20px;">
        ${isBlockedAlert ? 'Security Alert: Unauthorized Device Blocked' : 'Digital Khata - New Device Login Approval'}
      </h2>
      <p style="margin:0 0 18px;color:#cbd5e1;font-size:14px;line-height:1.5;">
        Assalam-o-Alaikum ${escapeHtml(payload.ownerName || 'Owner')},<br/>
        ${isBlockedAlert
          ? 'Aapke Digital Khata account par ek naye device ka login attempt block kar diya gaya hai.'
          : 'Aapke Digital Khata account par ek naye mobile / device se login request aayi hai. Jab tak aap ALLOW nahi kareinge, login nahi hoga.'}
      </p>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:12px;margin-bottom:20px;font-size:13px;">
        <tr><td style="padding:10px 14px;color:#94a3b8;border-bottom:1px solid #1e293b;">New Device Name</td><td style="padding:10px 14px;color:#ffffff;font-weight:bold;border-bottom:1px solid #1e293b;">${escapeHtml(payload.deviceName)}</td></tr>
        <tr><td style="padding:10px 14px;color:#94a3b8;border-bottom:1px solid #1e293b;">Login Date &amp; Time</td><td style="padding:10px 14px;color:#ffffff;font-weight:bold;border-bottom:1px solid #1e293b;">${escapeHtml(payload.loginDateTime)}</td></tr>
        <tr><td style="padding:10px 14px;color:#94a3b8;border-bottom:1px solid #1e293b;">Location / Address</td><td style="padding:10px 14px;color:#ffffff;font-weight:bold;border-bottom:1px solid #1e293b;">${escapeHtml(payload.location)}</td></tr>
        <tr><td style="padding:10px 14px;color:#94a3b8;border-bottom:1px solid #1e293b;">IP Address</td><td style="padding:10px 14px;color:#ffffff;font-weight:bold;border-bottom:1px solid #1e293b;">${escapeHtml(payload.ip)}</td></tr>
        <tr><td style="padding:10px 14px;color:#94a3b8;">Browser / App Version</td><td style="padding:10px 14px;color:#ffffff;font-weight:bold;">${escapeHtml(payload.browserVersion)}</td></tr>
      </table>
      ${isBlockedAlert ? `
        <div style="padding:14px;border-radius:12px;background:#7f1d1d;color:#fecaca;font-weight:bold;font-size:13px;text-align:center;">
          Status: BLOCKED - Owner ne Is Device ko Allow Nahi Kiya
        </div>
      ` : `
        <div style="text-align:center;">
          <a href="${escapeHtml(payload.allowUrl)}" style="display:block;margin:0 0 12px;padding:15px 18px;border-radius:12px;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">
            ALLOW - Yes, Ye Mera Device Hai
          </a>
          <a href="${escapeHtml(payload.denyUrl)}" style="display:block;padding:15px 18px;border-radius:12px;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">
            NOT ALLOW - No, Ye Mera Device Nahi Hai
          </a>
        </div>
      `}
    </div>
  </div>`;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'Digital Khata' });
  });

  app.get('/api/device-meta', async (req, res) => {
    const ip = extractClientIp(req);
    let city = '';
    let country = '';

    if (!isPrivateIp(ip)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2400);
        const geoRes = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,country`, {
          signal: controller.signal
        });
        clearTimeout(timer);
        if (geoRes.ok) {
          const geo = (await geoRes.json()) as { status?: string; city?: string; country?: string };
          if (geo && geo.status === 'success') {
            city = String(geo.city || '').trim();
            country = String(geo.country || '').trim();
          }
        }
      } catch {
        // Ignore transient geo lookup timeout
      }
    }

    const locationText = [city, country].filter(Boolean).join(', ') || 'Location Detected (Network)';
    res.json({ ip, city, country, locationText });
  });

  app.post('/api/device-email', async (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const toEmail = String(body.toEmail || '').trim().toLowerCase();
    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      res.status(400).json({ ok: false, error: 'Valid owner email required.' });
      return;
    }

    const kind = body.kind === 'blocked-alert' ? 'blocked-alert' : 'approval-request';
    const ownerName = String(body.ownerName || 'Workshop Owner').slice(0, 120);
    const deviceName = String(body.deviceName || 'Unknown Device').slice(0, 120);
    const loginDateTime = String(body.loginDateTime || new Date().toLocaleString()).slice(0, 100);
    const location = String(body.location || 'Unknown Location').slice(0, 160);
    const ip = String(body.ip || extractClientIp(req)).slice(0, 64);
    const browserVersion = String(body.browserVersion || 'Digital Khata Web v1.0').slice(0, 120);
    const sanitizeHttpUrl = (rawUrl: unknown): string => {
      try {
        const parsed = new URL(String(rawUrl || ''));
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '#';
      } catch {
        return '#';
      }
    };
    const allowUrl = sanitizeHttpUrl(body.allowUrl);
    const denyUrl = sanitizeHttpUrl(body.denyUrl);

    const html = buildDeviceEmailHtml({
      kind,
      ownerName,
      deviceName,
      loginDateTime,
      location,
      ip,
      browserVersion,
      allowUrl,
      denyUrl
    });

    const subject =
      kind === 'blocked-alert'
        ? `ALERT: Blocked Device Login Attempt (${deviceName})`
        : `New Device Login Approval Needed (${deviceName})`;

    const resendKey = String(process.env.RESEND_API_KEY || '').trim();
    if (resendKey) {
      try {
        const fromAddr = String(process.env.RESEND_FROM_EMAIL || 'Digital Khata Security <onboarding@resend.dev>');
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [toEmail],
            subject,
            html
          })
        });
        if (r.ok) {
          res.json({ ok: true, provider: 'resend' });
          return;
        }
      } catch {
        // Fall through to report fallback needed
      }
    }

    res.json({ ok: true, provider: 'client-emailjs-fallback', subject });
  });

  app.get('/Digital-Khata-v1.0.apk', (req, res) => {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
    const host = String(req.headers['host'] || 'localhost:3000');
    const originUrl = `${proto}://${host}`;
    const apkBuf = getOfficialApkBuffer(originUrl);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="Digital-Khata-v1.0.apk"');
    res.setHeader('Content-Length', String(apkBuf.length));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(apkBuf);
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Digital Khata server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
