# Security Specification: Digital Khata - Warsha Aluminium

## Collections & Access Matrix

1. **`/users/{userId}`**
   - **Read / List / Delete**: Authenticated owner (`request.auth.uid == userId`) or verified Admin.
   - **Create / Update**: Authenticated owner (`request.auth.uid == userId`), `uid == userId` immutable, strict allowlist of profile fields including `activeDeviceId`, `activeDeviceName`, `activeSessionId`, `activeDeviceCount`, `sessionVersion`, `lastLoginAt`.

2. **`/users/{userId}/vault/{docId}`**
   - **Allowed `docId`**: `'core'`, `'ledger'`, `'operations'`, `'kyc'`.
   - **Read / Write**: Authenticated owner (`request.auth.uid == userId`) or Admin. `payloadJson` bounded `<= 900000` bytes.

3. **`/users/{userId}/backups/{backupId}`**
   - **Read / Write**: Authenticated owner (`request.auth.uid == userId`) or Admin. Daily 12 AM & manual readable JSON snapshots bounded `<= 900000` bytes.

4. **`/users/{userId}/devices/{deviceId}`**
   - **Read / Write / Delete**: Authenticated owner (`request.auth.uid == userId`) or Admin. `deviceId` matches path, `uid == userId` immutable, `status in ['approved', 'revoked']`.

5. **`/users/{userId}/loginHistory/{entryId}`**
   - **Read / Create / Delete**: Authenticated owner (`request.auth.uid == userId`) or Admin. Immutable audit log (`allow update: if false`), `status in ['Allowed', 'Blocked']`.

6. **`/deviceApprovalLinks/{reqId}`**
   - **List**: `false` (enumeration blocked).
   - **Get**: Allowed only for exact valid capability ID `req_[a-zA-Z0-9_-]{16,80}`; stores no owner email PII.
   - **Create**: Authenticated user for own `uid == request.auth.uid`, `decision == 'pending'`, `tokenHash is bytes && tokenHash.size() == 32`, `approvalToken == ''`.
   - **Update**: Allowed once when `resource.data.decision == 'pending'` ONLY if `affectedKeys().hasOnly(['decision', 'decidedAt', 'approvalToken'])`, `decision in ['allowed', 'denied']`, and `hashing.sha256(request.resource.data.approvalToken) == resource.data.tokenHash`.
   - **Delete**: Authenticated owner (`resource.data.uid == request.auth.uid`) or Admin.

7. **`/cnicRegistry/{cnicHash}` & `/mobileRegistry/{mobileHash}`**
   - Unchanged 1 CNIC = 1 Account & 1 Mobile = 1 Account atomic claims.

8. **Default Deny**:
   - `match /{document=**} { allow read, write: if false; }`

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read/list on `/users/{uid}` -> DENIED.
2. Unauthenticated create on `/deviceApprovalLinks/req_fake1234567890123456` -> DENIED.
3. Authenticated user creating `/deviceApprovalLinks/req_...` with another user's `uid` -> DENIED.
4. Authenticated user creating `/deviceApprovalLinks/req_...` already set to `decision: 'allowed'` -> DENIED.
5. Approval update without matching raw `approvalToken` (`sha256(token) != tokenHash`) -> DENIED.
6. Approval update modifying `uid` or `deviceId` (shadow field update) -> DENIED.
7. Second approval update overwriting a terminal `'denied'` or `'allowed'` decision -> DENIED.
8. List query against `/deviceApprovalLinks` collection -> DENIED.
9. Injecting oversized string (>160 chars) into `deviceName` on `/users/{uid}/devices/{id}` -> DENIED.
10. Modifying `/users/{uid}/loginHistory/{id}` after creation -> DENIED (`update: false`).
11. Cross-user read on `/users/{otherUid}/devices/{id}` -> DENIED.
12. Ghost field `isAdmin: true` in `/users/{uid}` profile update -> DENIED.
