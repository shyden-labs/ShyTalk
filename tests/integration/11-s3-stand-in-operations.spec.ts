import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

/**
 * Integration test #11 — every S3 operation ShyTalk relies on, against the
 * local S3 stand-in (SHY-0544).
 *
 * Production storage is Cloudflare R2. Locally and in CI it is versitygw,
 * which replaced MinIO when MinIO withdrew its images. A stand-in that
 * silently lacked one operation would pass every mocked unit test and fail
 * only on a real device, so each operation the code uses is exercised here
 * against the running container, with the same SDK the API uses:
 *
 *   - PutObject, GetObject, HeadObject, DeleteObject, DeleteObjects
 *   - the seeded public-read bucket policy: an anonymous GET is served
 *   - presigned URLs: a presigned PUT, then a presigned GET of the same bytes
 *
 * CreateBucket and PutBucketPolicy run in local/seed.js before this suite;
 * the anonymous-GET test fails if either did not take effect.
 */

const requireApi = createRequire(resolve(__dirname, "../../express-api/package.json"));
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} = requireApi("@aws-sdk/client-s3");
const { getSignedUrl } = requireApi("@aws-sdk/s3-request-presigner");

const ENDPOINT = process.env.LOCAL_S3_ENDPOINT || "http://localhost:9002";
const BUCKET = process.env.R2_BUCKET_NAME || "shytalk-media";
const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.LOCAL_S3_ACCESS_KEY || "localadmin",
    secretAccessKey: process.env.LOCAL_S3_SECRET_KEY || "localsecret",
  },
});

const PREFIX = `integration/shy0544/${Date.now()}`;
const bytes = (label: string) => Buffer.from(`shy0544 ${label} ${PREFIX}`);

async function put(key: string, body: Buffer) {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "text/plain" }),
  );
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

test.describe("Integration — S3 stand-in operations", () => {
  test("PutObject then GetObject returns the same bytes", async () => {
    const key = `${PREFIX}/get.txt`;
    await put(key, bytes("get"));
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    expect(Buffer.from(await got.Body.transformToByteArray())).toEqual(bytes("get"));
  });

  test("HeadObject reports the stored size and content type", async () => {
    const key = `${PREFIX}/head.txt`;
    await put(key, bytes("head"));
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    expect({ length: head.ContentLength, type: head.ContentType }).toEqual({
      length: bytes("head").length,
      type: "text/plain",
    });
  });

  test("DeleteObject removes the object", async () => {
    const key = `${PREFIX}/delete-one.txt`;
    await put(key, bytes("delete-one"));
    expect(await exists(key)).toBe(true);
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    expect(await exists(key)).toBe(false);
  });

  test("DeleteObjects removes every listed object and reports each", async () => {
    const keys = [`${PREFIX}/many-a.txt`, `${PREFIX}/many-b.txt`];
    for (const key of keys) await put(key, bytes(key));
    const out = await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
    expect({
      deleted: (out.Deleted ?? []).map((d: { Key: string }) => d.Key).sort(),
      errors: out.Errors ?? [],
    }).toEqual({ deleted: [...keys].sort(), errors: [] });
    expect([await exists(keys[0]), await exists(keys[1])]).toEqual([false, false]);
  });

  test("an object in the seeded public-read bucket is served without credentials", async ({
    request,
  }) => {
    const key = `${PREFIX}/public.txt`;
    await put(key, bytes("public"));
    const res = await request.get(`${ENDPOINT}/${BUCKET}/${key}`);
    expect(res.status(), "anonymous GET of a public-read object").toBe(200);
    expect(await res.body()).toEqual(bytes("public"));
  });

  test("a presigned PUT stores bytes that a presigned GET returns", async ({ request }) => {
    const key = `${PREFIX}/presigned.txt`;
    const putUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: "text/plain" }),
      { expiresIn: 300 },
    );
    const uploaded = await request.put(putUrl, {
      headers: { "Content-Type": "text/plain" },
      data: bytes("presigned"),
    });
    expect(uploaded.status(), `presigned PUT: ${await uploaded.text()}`).toBe(200);

    const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
      expiresIn: 300,
    });
    const fetched = await request.get(getUrl);
    expect(fetched.status(), "presigned GET").toBe(200);
    expect(await fetched.body()).toEqual(bytes("presigned"));
  });

  test("a presigned URL with a forged signature is refused", async ({ request }) => {
    const key = `${PREFIX}/forged.txt`;
    const putUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: "text/plain" }),
      { expiresIn: 300 },
    );
    const forged = putUrl.replace(/X-Amz-Signature=([0-9a-f])/, (_m, c: string) =>
      `X-Amz-Signature=${c === "0" ? "1" : "0"}`,
    );
    expect(forged).not.toBe(putUrl);
    const res = await request.put(forged, {
      headers: { "Content-Type": "text/plain" },
      data: bytes("forged"),
    });
    expect(res.status()).toBe(403);
    expect(await exists(key)).toBe(false);
  });

  test.afterAll(async () => {
    // Objects the tests above leave behind (the delete tests clean their own).
    const keys = ["get", "head", "public", "presigned"].map((k) => ({ Key: `${PREFIX}/${k}.txt` }));
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
  });
});
