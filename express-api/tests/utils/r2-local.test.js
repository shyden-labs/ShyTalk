function setupR2Mock() {
  const mockSend = jest.fn().mockResolvedValue({});
  const MockS3Client = jest.fn().mockImplementation(() => ({ send: mockSend }));
  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: MockS3Client,
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    DeleteObjectsCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
  }));
  return { MockS3Client, mockSend };
}

describe('r2.js local mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('creates S3Client with the local S3 stand-in endpoint in local mode', () => {
    process.env.NODE_ENV = 'local';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:9002',
        forcePathStyle: true,
      }),
    );
  });

  test('uses LOCAL_S3_ENDPOINT env var when set', () => {
    process.env.NODE_ENV = 'local';
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    process.env.LOCAL_S3_ENDPOINT = 'http://custom-host:9999';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      expect.objectContaining({ endpoint: 'http://custom-host:9999' }),
    );
  });

  // SHY-0544: the stand-in's root keys, matching local/docker-compose.yml.
  test('signs with the local stand-in keys by default', () => {
    process.env.NODE_ENV = 'local';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: 'localadmin', secretAccessKey: 'localsecret' },
      }),
    );
  });

  // SHY-0544: a .env.local written before the rename still says
  // MINIO_ENDPOINT=<LAN IP>. Ignoring it would fall back to localhost, which
  // a phone cannot reach, and every device upload would hang with no error.
  test.each(['MINIO_ENDPOINT', 'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'])(
    'refuses to load in local mode while the retired %s is set, naming its replacement',
    (retired) => {
      process.env.NODE_ENV = 'local';
      process.env[retired] = 'left-over';
      setupR2Mock();
      expect(() => require('../../src/utils/r2')).toThrow(
        new RegExp(`${retired} .*retired.*rename it to LOCAL_S3_`),
      );
    },
  );

  test('the retired names are ignored outside local mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.MINIO_ENDPOINT = 'left-over';
    process.env.R2_ACCOUNT_ID = 'acct';
    setupR2Mock();
    expect(() => require('../../src/utils/r2')).not.toThrow();
  });

  test('uses LOCAL_S3_ACCESS_KEY and LOCAL_S3_SECRET_KEY when set', () => {
    process.env.NODE_ENV = 'local';
    process.env.LOCAL_S3_ACCESS_KEY = 'key-from-env';
    process.env.LOCAL_S3_SECRET_KEY = 'secret-from-env';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: 'key-from-env', secretAccessKey: 'secret-from-env' },
      }),
    );
  });

  test('CDN_URL follows LOCAL_S3_ENDPOINT in local mode', () => {
    process.env.NODE_ENV = 'local';
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    process.env.LOCAL_S3_ENDPOINT = 'http://192.0.2.7:9002';
    setupR2Mock();
    const { CDN_URL } = require('../../src/utils/r2');
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(CDN_URL).toBe('http://192.0.2.7:9002/shytalk-media');
  });

  test('CDN_URL defaults to the local S3 stand-in in local mode', () => {
    process.env.NODE_ENV = 'local';
    setupR2Mock();
    const { CDN_URL } = require('../../src/utils/r2');
    expect(CDN_URL).toBe('http://localhost:9002/shytalk-media');
  });

  test('CDN_URL env var overrides local default', () => {
    process.env.NODE_ENV = 'local';
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    process.env.CDN_URL = 'http://custom-cdn:8080/media';
    setupR2Mock();
    const { CDN_URL } = require('../../src/utils/r2');
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(CDN_URL).toBe('http://custom-cdn:8080/media');
  });

  test('creates S3Client with R2 endpoint in non-local mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://test-account.r2.cloudflarestorage.com',
      }),
    );
  });
});
