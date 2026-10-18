#!/usr/bin/env node
/**
 * Dev environment reset: wipe the dev Firestore, R2 storage and RTDB, then re-seed
 * the dev fixtures.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/dev-sa.json node scripts/reset-data.mjs
 *
 * Optional env vars (for the R2 wipe; loaded from express-api/.env if present):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * What this does:
 *   1. Deletes every document of every known Firestore collection; conversations
 *      go as one tree through deleteTree (SHY-0631)
 *   2. Resets the uniqueId counter to 10000000
 *   3. Deletes every R2 object outside system/
 *   4. Clears the RTDB rooms and conversations nodes
 *   5. Re-seeds the dev fixtures (gifts, economy config, banner)
 *
 * Dev only (SHY-0641; Shyden, 2026-10-18: "Dev only"): it refuses `--env prod`, any
 * project but shytalk-dev and any bucket but shytalk-media-dev. A production wipe,
 * if ever needed, is a workflow gated by the `production` environment, never this.
 * A failed step fails the run: it never reports "complete" after one.
 *
 * Importing this file runs nothing (the tests import its steps); `main` runs only
 * when the file is executed.
 */

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// SHY-0631: the one helper that deletes a conversation's whole tree (CommonJS,
// no imports of its own, so it runs against this script's Firestore).
const { deleteTree } = createRequire(import.meta.url)('../express-api/src/utils/delete-tree.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEV_PROJECT = 'shytalk-dev';
export const DEV_BUCKET = 'shytalk-media-dev';
const DEV_RTDB_REGION = 'europe-west1';

/**
 * Why this run must not start, or null. Every route to production is refused.
 * @param {{ argv: string[], projectId: string, bucket?: string }} input
 */
export function refusal({ argv, projectId, bucket = DEV_BUCKET }) {
  const envFlag = argv.indexOf('--env');
  const env = envFlag === -1 ? 'dev' : argv[envFlag + 1];
  if (env === 'prod') {
    return 'production mode was removed (SHY-0641, Shyden 2026-10-18): this script only resets dev';
  }
  if (env !== 'dev') return `--env ${env}: this script only resets dev`;
  if (projectId !== DEV_PROJECT) {
    return `${projectId} is not the dev project (${DEV_PROJECT}); nothing was deleted`;
  }
  if (bucket !== DEV_BUCKET) {
    return `${bucket} is not the dev bucket (${DEV_BUCKET}); nothing was deleted`;
  }
  return null;
}

// ── Collections ──
export const TOP_LEVEL_COLLECTIONS = [
  'users',
  'rooms',
  'conversations',
  'deviceBindings',
  'gifts',
  'giftCatalog',
  'economyConfig',
  'banners',
  'reports',
  'appeals',
  'subscriptions',
  'logConfig',
  'deviceBans',
  'networkBans',
  'config',
  'coinPackages',
  'purchaseReceipts',
  'reportLocks',
  'reportsArchive',
  'suspensionAppeals',
  'broadcasts',
  'adminAuditLog',
  'alertConfig',
  'identityMap',
  'counters',
];

// parent → [subcollection names]
export const SUBCOLLECTIONS = {
  rooms: ['messages', 'seatRequests'],
  users: ['backpack', 'giftWall', 'transactions', 'stalkers'],
};

export async function deleteCollection(db, collectionPath) {
  let total = 0;
  while (true) {
    const snapshot = await db.collection(collectionPath).limit(500).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    total += snapshot.size;
  }
  return total;
}

/** Conversations go as one tree (SHY-0631): edits, recall, settings and mod_log too. */
export async function deleteConversations(db, deleteTreeFn = deleteTree) {
  const counts = await deleteTreeFn(db, db.collection('conversations'));
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** Delete every object under the known R2 folders; returns how many went. Errors propagate. */
export async function wipeR2(env) {
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } =
    await import('@aws-sdk/client-s3');
  const bucketName = env.R2_BUCKET_NAME || DEV_BUCKET;
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const folders = [
    'profiles/',
    'covers/',
    'messages/',
    'groups/',
    'evidence/',
    'stickers/',
    'banners/',
  ];
  let r2Total = 0;
  for (const prefix of folders) {
    const allKeys = [];
    let continuationToken;
    do {
      const resp = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of resp.Contents || []) allKeys.push(obj.Key);
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    for (let i = 0; i < allKeys.length; i += 1000) {
      const batch = allKeys.slice(i, i + 1000);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: batch.map((k) => ({ Key: k })) },
        }),
      );
    }
    r2Total += allKeys.length;
  }
  return r2Total;
}

/**
 * The reset itself. Every step's failure rejects the run; nothing after a failed
 * step runs, and "complete" is printed only when every step went.
 * @param {{ db: object, rtdb: object, wipeR2: (() => Promise<number>) | null,
 *   deleteTreeFn?: Function, log?: (line: string) => void }} deps
 */
export async function run({
  db,
  rtdb,
  wipeR2: wipe,
  deleteTreeFn = deleteTree,
  log = console.log,
}) {
  let grandTotal = 0;

  log('Phase 1: Deleting subcollections...');
  const convTotal = await deleteConversations(db, deleteTreeFn);
  grandTotal += convTotal;
  if (convTotal > 0) log(`  conversations/**: ${convTotal} docs deleted`);
  for (const [parent, subs] of Object.entries(SUBCOLLECTIONS)) {
    const parentDocs = await db.collection(parent).listDocuments();
    for (const sub of subs) {
      let subTotal = 0;
      for (const parentRef of parentDocs) {
        subTotal += await deleteCollection(db, `${parent}/${parentRef.id}/${sub}`);
      }
      grandTotal += subTotal;
      if (subTotal > 0) log(`  ${parent}/*/${sub}: ${subTotal} docs deleted`);
    }
  }

  log('\nPhase 2: Deleting top-level collections...');
  for (const name of TOP_LEVEL_COLLECTIONS) {
    const deleted = await deleteCollection(db, name);
    grandTotal += deleted;
    if (deleted > 0) log(`  ${name}: ${deleted} docs deleted`);
  }
  log(`\nFirestore: ${grandTotal} total documents deleted`);

  log('\nPhase 3: Resetting uniqueId counter to 10000000...');
  await db.doc('counters/uniqueId').set({ value: 10000000 });

  if (wipe) {
    log('\nPhase 4: Wiping R2 storage...');
    const r2Total = await wipe();
    log(`  R2 total: ${r2Total} objects deleted (system/ folder preserved)`);
  } else {
    log('\nPhase 4: Skipping R2 wipe (R2 credentials not set)');
  }

  log('\nPhase 5: Clearing RTDB...');
  await rtdb.ref('rooms').remove();
  await rtdb.ref('conversations').remove();

  log('\nPhase 6: Re-seeding dev fixtures...');
  await seedFixtures(db, log);

  log('\n✅ DEV environment reset complete!');
  log(`   Firestore: ${grandTotal} docs deleted, counter reset to 10000000; fixtures re-seeded`);
}

export async function seedFixtures(db, log = console.log) {
  // Gifts
  const gifts = [
    { id: 'rose', name: 'Rose', coinValue: 1, order: 1, showInStore: true, showOnWheel: true },
    {
      id: 'lollipop',
      name: 'Lollipop',
      coinValue: 5,
      order: 2,
      showInStore: true,
      showOnWheel: true,
    },
    {
      id: 'ice_cream',
      name: 'Ice Cream',
      coinValue: 10,
      order: 3,
      showInStore: true,
      showOnWheel: true,
    },
    { id: 'coffee', name: 'Coffee', coinValue: 25, order: 4, showInStore: true, showOnWheel: true },
    {
      id: 'teddy_bear',
      name: 'Teddy Bear',
      coinValue: 50,
      order: 5,
      showInStore: true,
      showOnWheel: true,
    },
    { id: 'heart', name: 'Heart', coinValue: 25, order: 6, showInStore: true, showOnWheel: true },
    { id: 'star', name: 'Star', coinValue: 10, order: 7, showInStore: true, showOnWheel: true },
    { id: 'crown', name: 'Crown', coinValue: 5000, order: 8, showInStore: true, showOnWheel: true },
    {
      id: 'diamond_ring',
      name: 'Diamond Ring',
      coinValue: 2000,
      order: 9,
      showInStore: true,
      showOnWheel: true,
    },
    {
      id: 'universe',
      name: 'Universe',
      coinValue: 200000,
      order: 10,
      showInStore: true,
      showOnWheel: true,
    },
  ];

  for (const g of gifts) {
    await db
      .doc(`gifts/${g.id}`)
      .set({ ...g, weight: 1.0, animationUrl: '', soundUrl: '', iconUrl: '' });
  }
  log(`  Created ${gifts.length} gifts`);

  // Fun facts
  // Banner
  await db.doc('banners/dev_banner_1').set({
    id: 'dev_banner_1',
    title: 'Dev Test Banner',
    imageUrl: 'https://dev-images.shytalk.shyden.co.uk/system/shytalk_icon.webp',
    actionType: 'NONE',
    actionValue: '',
    isActive: true,
    sortOrder: 1,
    startDate: Date.now(),
    endDate: null,
  });
  log('  Created 1 banner');

  // Economy config
  await db.doc('config/economy').set({
    dailyLoginReward: 100,
    gachaSpinCost: 50,
    gachaPityThreshold: 50,
  });
  log('  Created economy config');
}

/** Load express-api/.env into env without overriding what is already set. */
function loadEnvFile(env) {
  const envPath = resolve(__dirname, '..', 'express-api', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!env[key]) env[key] = trimmed.slice(eqIdx + 1).trim();
  }
}

export async function main(argv, env = process.env) {
  loadEnvFile(env);
  const saPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!saPath)
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to the dev service account JSON path');
  const sa = JSON.parse(readFileSync(saPath, 'utf-8'));
  const r2Ready = Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
  const why = refusal({
    argv,
    projectId: sa.project_id,
    bucket: r2Ready ? env.R2_BUCKET_NAME || DEV_BUCKET : DEV_BUCKET,
  });
  if (why) throw new Error(`Refused: ${why}`);

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getDatabase } = await import('firebase-admin/database');
  const rtdbUrl =
    env.FIREBASE_DATABASE_URL ||
    `https://${sa.project_id}-default-rtdb.${DEV_RTDB_REGION}.firebasedatabase.app`;
  initializeApp({ credential: cert(sa), databaseURL: rtdbUrl });
  console.log(`\n🔄 Resetting DEV environment: ${sa.project_id}`);
  console.log(`   RTDB: ${rtdbUrl}\n`);
  await run({
    db: getFirestore(),
    rtdb: getDatabase(),
    wipeR2: r2Ready ? () => wipeR2(env) : null,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
