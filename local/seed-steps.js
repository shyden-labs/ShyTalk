/**
 * The seed steps that talk to a service, kept apart from `seed.js` so they
 * can be driven with stand-in clients (express-api/tests/utils/seed-steps.test.js).
 * Clients and SDK command classes are passed in: this file requires nothing,
 * so it resolves the same from `seed.js` (NODE_PATH=express-api/node_modules)
 * and from Jest.
 *
 * Every failure is thrown. A step that fails must never let the seed print
 * "Seed complete." (SHY-0544): a missing bucket or user only surfaces later,
 * on a device, far from its cause.
 */

const BUCKET_ALREADY_THERE = new Set(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists']);

/** Anyone may read an object in the bucket; nothing else is granted. */
function publicReadPolicy(bucket) {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

function stepFailed(message, cause) {
  return new Error(`${message}: ${cause.message}`, { cause });
}

/**
 * Creates the media bucket on the local S3 stand-in, keeping one that is
 * already there, and makes its objects publicly readable (`CDN_URL` serves
 * them without credentials).
 */
async function seedPublicReadBucket({ s3Client, bucket, commands, log = console.log }) {
  const { CreateBucketCommand, PutBucketPolicyCommand } = commands;
  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    log(`  Created: ${bucket}`);
  } catch (err) {
    if (!BUCKET_ALREADY_THERE.has(err.name)) {
      throw stepFailed(`S3 stand-in: could not create bucket ${bucket}`, err);
    }
    log(`  Exists:  ${bucket}`);
  }
  try {
    await s3Client.send(
      new PutBucketPolicyCommand({ Bucket: bucket, Policy: publicReadPolicy(bucket) }),
    );
  } catch (err) {
    throw stepFailed(`S3 stand-in: could not make bucket ${bucket} public-read`, err);
  }
  log(`  Policy:  public-read on ${bucket}`);
}

/**
 * Returns the uid of the Auth user with this email, creating the user when
 * there is none. Only "no such user" leads to a create; any other lookup
 * failure is thrown as it came.
 */
async function seedAuthUser({
  auth,
  email,
  password,
  displayName,
  customClaims,
  log = console.log,
}) {
  let uid;
  try {
    const existing = await auth.getUserByEmail(email);
    log(`  Exists:  Auth user ${email}`);
    uid = existing.uid;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    const created = await auth.createUser({ email, password, displayName, emailVerified: true });
    log(`  Created: Auth user ${email}`);
    uid = created.uid;
  }
  // Set custom claims (e.g., admin: true) — idempotent
  if (customClaims) {
    await auth.setCustomUserClaims(uid, customClaims);
  }
  return uid;
}

module.exports = { publicReadPolicy, seedPublicReadBucket, seedAuthUser };
