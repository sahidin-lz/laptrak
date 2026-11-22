# Security Specification — Phase 0: Payload-First Security TDD

## 1. Data Invariants
1. **Default Deny & Verified Identity**: Every read or write must be authenticated (`request.auth != null`) and for writes/reads require `request.auth.token.email_verified == true` or bootstrapped admin verification (`sahidin30@gmail.com` / `/admins/{uid}`).
2. **Quota-Optimized Bundle Integrity (`/kiosk_bundles/{bundleId}`)**:
   - `bundleId` must pass `isValidId(bundleId)` (`<= 128` chars, `^[a-zA-Z0-9_\-]+$`) and equal `incoming().bundleId`.
   - `ownerId` must equal `request.auth.uid` on creation and remain immutable (`incoming().ownerId == existing().ownerId`) on update.
   - `createdAt` must equal `request.time` on creation and remain immutable on update.
   - `updatedAt` must equal `request.time` on create and update.
   - Strict key allowlisting via `hasAll` and `hasOnly` prevents shadow fields.
3. **Transaction Audit Integrity (`/transaction_audits/{txId}`)**:
   - `txId` must pass `isValidId(txId)` and match `incoming().txId`.
   - `ownerId` must match `request.auth.uid` on creation and remain immutable on update.
   - `transactionType` must be `'harian'` or `'pulang'`.
   - `status` must be `'active'` or `'returned'`. Terminal state lock: once `existing().status == 'returned'`, further non-admin updates are blocked.
   - `allow list` enforces `resource.data.ownerId == request.auth.uid || isAdmin()` without any `get()` or `exists()` calls inside `list`.
4. **Admin Escalation Prevention (`/admins/{adminUid}`)**:
   - Client writes (`create`, `update`, `delete`) to `/admins/{adminUid}` are strictly forbidden (`if false;`) to prevent self-assigned roles.

## 2. The "Dirty Dozen" Payloads (Designed to Break Identity, Integrity & State)
1. **Unauthenticated Write**: `auth = null`, creating `/kiosk_bundles/main` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'u1', email: 'sahidin30@gmail.com', email_verified: false }` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: `auth.uid = 'u1'`, payload `ownerId: 'u2'` on `/kiosk_bundles/main` -> `PERMISSION_DENIED`.
4. **Shadow / Ghost Field Injection on Create**: Adding `isSuperAdmin: true` to `/kiosk_bundles/main` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection on Update**: Updating `/kiosk_bundles/main` with `hacked: 'yes'` -> `PERMISSION_DENIED`.
6. **Immutable Field Mutation (`ownerId`)**: Changing `ownerId` during update on `/kiosk_bundles/main` -> `PERMISSION_DENIED`.
7. **Immutable Field Mutation (`createdAt`)**: Changing `createdAt` during update on `/kiosk_bundles/main` -> `PERMISSION_DENIED`.
8. **Forged Client Timestamp (`updatedAt`)**: Supplying `updatedAt` != `request.time` -> `PERMISSION_DENIED`.
9. **Path ID Poisoning**: Document ID with illegal characters or mismatching `incoming().bundleId` -> `PERMISSION_DENIED`.
10. **Value Poisoning / Oversized String**: `schoolName` with 500 characters (`> 120` max) or wrong type -> `PERMISSION_DENIED`.
11. **Terminal State Bypass**: Updating `/transaction_audits/{txId}` after `existing().status == 'returned'` as non-admin -> `PERMISSION_DENIED`.
12. **Self-Assigned Admin Privilege Escalation**: User writing to `/admins/u1` -> `PERMISSION_DENIED`.
