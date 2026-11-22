/**
 * Phase 0 Test Specification for Firestore Security Rules (`firestore.rules`)
 * Verifies that all 12 Dirty Dozen adversarial payloads are rejected with PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'delete' | 'get' | 'list';
  auth: {
    uid: string;
    email?: string;
    email_verified?: boolean;
  } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated create on kiosk_bundles',
    collectionPath: '/kiosk_bundles/main',
    operation: 'create',
    auth: null,
    payload: {
      bundleId: 'main',
      ownerId: 'anon',
      schoolName: 'SMA 1',
      payloadJson: '{}',
      version: 1,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email spoof attack matching admin email',
    collectionPath: '/kiosk_bundles/main',
    operation: 'get',
    auth: {
      uid: 'attacker-1',
      email: 'sahidin30@gmail.com',
      email_verified: false,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity spoofing: ownerId does not match request.auth.uid',
    collectionPath: '/kiosk_bundles/main',
    operation: 'create',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      bundleId: 'main',
      ownerId: 'user-2',
      schoolName: 'SMA 1',
      payloadJson: '{}',
      version: 1,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow field injection on create',
    collectionPath: '/kiosk_bundles/main',
    operation: 'create',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      bundleId: 'main',
      ownerId: 'user-1',
      schoolName: 'SMA 1',
      payloadJson: '{}',
      version: 1,
      isSuperAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow field injection on update',
    collectionPath: '/kiosk_bundles/main',
    operation: 'update',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      payloadJson: '{"updated":true}',
      ghostFlag: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Immutable ownerId mutation on update',
    collectionPath: '/kiosk_bundles/main',
    operation: 'update',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      ownerId: 'user-999',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable createdAt mutation on update',
    collectionPath: '/kiosk_bundles/main',
    operation: 'update',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      createdAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Forged client timestamp on update',
    collectionPath: '/kiosk_bundles/main',
    operation: 'update',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      updatedAt: '2099-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Path ID mismatch with payload bundleId',
    collectionPath: '/kiosk_bundles/main',
    operation: 'create',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      bundleId: 'different-id',
      ownerId: 'user-1',
      schoolName: 'SMA 1',
      payloadJson: '{}',
      version: 1,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Value poisoning with oversized schoolName',
    collectionPath: '/kiosk_bundles/main',
    operation: 'create',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      bundleId: 'main',
      ownerId: 'user-1',
      schoolName: 'A'.repeat(300),
      payloadJson: '{}',
      version: 1,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Terminal state bypass on returned transaction_audits record',
    collectionPath: '/transaction_audits/tx-1',
    operation: 'update',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Self-assigned admin privilege escalation on /admins/{uid}',
    collectionPath: '/admins/user-1',
    operation: 'create',
    auth: {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: true,
    },
    payload: {
      uid: 'user-1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
