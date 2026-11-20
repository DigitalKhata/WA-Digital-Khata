# Security Specification: Digital Khata - Warsha Aluminium

## Collections & Access Matrix

1. **`/users/{userId}`**
   - **Read / List / Delete**: Only authenticated owner (`request.auth != null && request.auth.uid == userId`).
   - **Create**: Authenticated owner (`request.auth.uid == userId`), `uid == userId`, valid string `name` (1..120 chars), valid number `updatedAt`, bounded optional fields (`email`, `mobile`, `identifier`, `authType`, `pinEnabled`, `pinHash`, `lastSyncAt`, `lastBackupAt`, `createdAt`), total key count <= 14.
   - **Update**: Authenticated owner (`request.auth.uid == userId`), `uid` immutable (`request.resource.data.uid == resource.data.uid`), `createdAt` immutable when present, valid types and lengths.

2. **`/users/{userId}/vault/{docId}`**
   - **Allowed `docId`**: `'core'`, `'ledger'`, `'operations'`, `'kyc'`.
   - **Read / Delete**: Authenticated owner only (`request.auth.uid == userId`).
   - **Create / Update**: Authenticated owner (`request.auth.uid == userId`), `docId in ['core', 'ledger', 'operations', 'kyc']`, `uid == userId` (immutable on update), `docType == docId`, `payloadJson` string <= 900,000 bytes, `updatedAt` is a positive number.

3. **`/users/{userId}/backups/{backupId}`**
   - **Read / Delete**: Authenticated owner only (`request.auth.uid == userId`).
   - **Create / Update**: Authenticated owner (`request.auth.uid == userId`), `uid == userId` (immutable on update), `id == backupId`, `kind in ['daily', 'manual']`, `dateKey` matches `YYYY-MM-DD`, `payloadJson` string <= 900,000 bytes, `createdAt` is a positive number.

4. **Default Deny**:
   - `match /{document=**} { allow read, write: if false; }`
