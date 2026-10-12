/**
 * The two seed steps that talk to a service, `local/seed-steps.js`, driven
 * with stand-in clients.
 *
 * SHY-0544: the bucket step used to sit inside a catch that printed a warning
 * and carried on, so a stand-in that refused the bucket or its policy still
 * ended "Seed complete." with exit 0, and images then failed on every device
 * with nothing at start-up pointing at why. The test it replaces exercised
 * its own mocks and never loaded the seed. These load the real steps.
 */
const {
  seedPublicReadBucket,
  publicReadPolicy,
  seedAuthUser,
} = require('../../../local/seed-steps');

// Stand-ins for the SDK's command classes: they keep the input they were
// built with, which is all a client's send() reads.
class CreateBucketCommand {
  constructor(input) {
    this.input = input;
  }
}
class PutBucketPolicyCommand {
  constructor(input) {
    this.input = input;
  }
}
const commands = { CreateBucketCommand, PutBucketPolicyCommand };

function s3ClientAnswering(...answers) {
  const send = jest.fn();
  for (const answer of answers) {
    if (answer instanceof Error) send.mockRejectedValueOnce(answer);
    else send.mockResolvedValueOnce(answer);
  }
  return { send };
}

function namedError(name, message = name) {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('seedPublicReadBucket', () => {
  test('creates the bucket, then gives it the public-read policy', async () => {
    const s3Client = s3ClientAnswering({}, {});
    const log = jest.fn();

    await seedPublicReadBucket({ s3Client, bucket: 'shytalk-media', commands, log });

    expect(s3Client.send).toHaveBeenCalledTimes(2);
    const [create] = s3Client.send.mock.calls[0];
    const [policy] = s3Client.send.mock.calls[1];
    expect(create).toBeInstanceOf(CreateBucketCommand);
    expect(create.input).toEqual({ Bucket: 'shytalk-media' });
    expect(policy).toBeInstanceOf(PutBucketPolicyCommand);
    expect(policy.input).toEqual({
      Bucket: 'shytalk-media',
      Policy: publicReadPolicy('shytalk-media'),
    });
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '  Created: shytalk-media',
      '  Policy:  public-read on shytalk-media',
    ]);
  });

  test('a bucket we already own is kept, and the policy is still set', async () => {
    const s3Client = s3ClientAnswering(namedError('BucketAlreadyOwnedByYou'), {});
    const log = jest.fn();

    await seedPublicReadBucket({ s3Client, bucket: 'shytalk-media', commands, log });

    expect(s3Client.send).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '  Exists:  shytalk-media',
      '  Policy:  public-read on shytalk-media',
    ]);
  });

  test('a bucket that already exists is kept, and the policy is still set', async () => {
    const s3Client = s3ClientAnswering(namedError('BucketAlreadyExists'), {});
    const log = jest.fn();

    await seedPublicReadBucket({ s3Client, bucket: 'shytalk-media', commands, log });

    expect(s3Client.send).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '  Exists:  shytalk-media',
      '  Policy:  public-read on shytalk-media',
    ]);
  });

  test('a stand-in that cannot be reached fails the step, naming the bucket and the cause', async () => {
    const refused = namedError('Error', 'connect ECONNREFUSED 127.0.0.1:9002');
    const s3Client = s3ClientAnswering(refused);
    const log = jest.fn();

    const attempt = seedPublicReadBucket({ s3Client, bucket: 'shytalk-media', commands, log });

    await expect(attempt).rejects.toThrow(
      'S3 stand-in: could not create bucket shytalk-media: connect ECONNREFUSED 127.0.0.1:9002',
    );
    await expect(attempt).rejects.toHaveProperty('cause', refused);
    expect(s3Client.send).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  test('a refused policy fails the step, so the bucket is never reported public', async () => {
    const denied = namedError('AccessDenied', 'Access Denied');
    const s3Client = s3ClientAnswering({}, denied);
    const log = jest.fn();

    const attempt = seedPublicReadBucket({ s3Client, bucket: 'shytalk-media', commands, log });

    await expect(attempt).rejects.toThrow(
      'S3 stand-in: could not make bucket shytalk-media public-read: Access Denied',
    );
    await expect(attempt).rejects.toHaveProperty('cause', denied);
    expect(log.mock.calls.map(([line]) => line)).toEqual(['  Created: shytalk-media']);
  });
});

describe('publicReadPolicy', () => {
  test('lets anyone read objects in the bucket, and nothing else', () => {
    expect(JSON.parse(publicReadPolicy('shytalk-media'))).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: ['arn:aws:s3:::shytalk-media/*'],
        },
      ],
    });
  });
});

describe('seedAuthUser', () => {
  function authStandIn({ lookup, created = { uid: 'new-uid' } }) {
    return {
      getUserByEmail: jest.fn(() =>
        lookup instanceof Error ? Promise.reject(lookup) : Promise.resolve(lookup),
      ),
      createUser: jest.fn().mockResolvedValue(created),
      setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    };
  }
  function notFound() {
    const err = new Error('There is no user record corresponding to the provided identifier.');
    err.code = 'auth/user-not-found';
    return err;
  }

  test('an existing user is kept and its uid returned', async () => {
    const auth = authStandIn({ lookup: { uid: 'old-uid' } });
    const log = jest.fn();

    const uid = await seedAuthUser({
      auth,
      email: 'user@test.com',
      password: 'pw',
      displayName: 'U',
      log,
    });

    expect(uid).toBe('old-uid');
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('  Exists:  Auth user user@test.com');
  });

  test('a user that does not exist is created, verified, and its uid returned', async () => {
    const auth = authStandIn({ lookup: notFound() });
    const log = jest.fn();

    const uid = await seedAuthUser({
      auth,
      email: 'user@test.com',
      password: 'pw',
      displayName: 'U',
      log,
    });

    expect(uid).toBe('new-uid');
    expect(auth.createUser).toHaveBeenCalledWith({
      email: 'user@test.com',
      password: 'pw',
      displayName: 'U',
      emailVerified: true,
    });
    expect(log).toHaveBeenCalledWith('  Created: Auth user user@test.com');
  });

  test('a lookup that fails for any other reason fails the step and creates nobody', async () => {
    const down = new Error('connect ECONNREFUSED 127.0.0.1:9099');
    down.code = 'app/network-error';
    const auth = authStandIn({ lookup: down });

    const attempt = seedAuthUser({
      auth,
      email: 'user@test.com',
      password: 'pw',
      displayName: 'U',
      log: jest.fn(),
    });

    await expect(attempt).rejects.toBe(down);
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  test('custom claims are set on the user when given', async () => {
    const auth = authStandIn({ lookup: { uid: 'old-uid' } });

    await seedAuthUser({
      auth,
      email: 'claude-test@shytalk.dev',
      password: 'pw',
      displayName: 'A',
      customClaims: { admin: true },
      log: jest.fn(),
    });

    expect(auth.setCustomUserClaims).toHaveBeenCalledWith('old-uid', { admin: true });
  });

  test('no claims call is made when none are given', async () => {
    const auth = authStandIn({ lookup: { uid: 'old-uid' } });

    await seedAuthUser({
      auth,
      email: 'user@test.com',
      password: 'pw',
      displayName: 'U',
      log: jest.fn(),
    });

    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
  });
});
