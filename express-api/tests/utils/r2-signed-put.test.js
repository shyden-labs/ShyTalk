/**
 * Tests for the R2 signed-PUT URL helper. Used by the age-verification
 * upload-url endpoint so the client can PUT the ID image directly to
 * R2 without proxying through Express (saves bandwidth on the cheap
 * Oracle VM).
 *
 * Runtime delegates to @aws-sdk/s3-request-presigner. We mock that
 * out so the test doesn't need real R2 / versitygw credentials and so we
 * can pin the exact arguments passed (bucket, key, content type,
 * expires-in seconds).
 */

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args) => mockGetSignedUrl(...args),
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const original = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...original,
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockS3Send,
    })),
  };
});

const { getSignedPutUrl, bucketName } = require('../../src/utils/r2');

beforeEach(() => {
  mockGetSignedUrl.mockClear();
  mockGetSignedUrl.mockResolvedValue('https://r2-signed/abc?expires=1h');
});

describe('getSignedPutUrl', () => {
  test('returns the signed URL string from the presigner', async () => {
    const url = await getSignedPutUrl('age-verification/u1/abc.jpg', 'image/jpeg');
    expect(url).toBe('https://r2-signed/abc?expires=1h');
  });

  test('passes bucket + key + content-type to PutObjectCommand', async () => {
    await getSignedPutUrl('age-verification/u1/abc.jpg', 'image/jpeg');

    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [, command] = mockGetSignedUrl.mock.calls[0];
    expect(command.input).toMatchObject({
      Bucket: bucketName,
      Key: 'age-verification/u1/abc.jpg',
      ContentType: 'image/jpeg',
    });
  });

  test('default expiry is 5 minutes (short-lived to limit replay window)', async () => {
    // The signed URL is single-use in spirit but R2 doesn't enforce
    // single-use semantics — only an expiry. Keeping the window
    // tight (5min) limits exposure if a URL is intercepted.
    await getSignedPutUrl('age-verification/u1/abc.jpg', 'image/jpeg');
    const [, , options] = mockGetSignedUrl.mock.calls[0];
    expect(options).toEqual({ expiresIn: 300 });
  });

  test('caller can override expiry but not exceed 1 hour (defense-in-depth)', async () => {
    await getSignedPutUrl('age-verification/u1/abc.jpg', 'image/jpeg', 600);
    const [, , options] = mockGetSignedUrl.mock.calls[0];
    expect(options).toEqual({ expiresIn: 600 });
  });

  test('rejects expiry > 1 hour', async () => {
    await expect(
      getSignedPutUrl('age-verification/u1/abc.jpg', 'image/jpeg', 7200),
    ).rejects.toThrow(/expiresInSec/);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  test('rejects empty key', async () => {
    await expect(getSignedPutUrl('', 'image/jpeg')).rejects.toThrow(/key/);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  test('rejects empty contentType', async () => {
    await expect(getSignedPutUrl('age-verification/u1/abc.jpg', '')).rejects.toThrow(/contentType/);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});
