import TOS, { StorageClassType } from '../../src/browser-index';
import { createDefaultRateLimiter } from '../../src/universal/rate-limiter';
import { NEVER_TIMEOUT } from '../utils';
import fs from 'fs';
import { tosOptions } from '../utils/options';
import { downloadFileDir, objectKey10M, objectPath10M } from './utils';

const commonCapacity = 1024 * 1024;
const commonRate = 0.2 * 1024 * 1024;
const commonLimiterTime = 5 * 1000;

async function readAllData(
  readableStream: NodeJS.ReadableStream,
  readBegin: number = Date.now()
): Promise<{ readBegin: number; duration: number; readEnd: number }> {
  let data = '';

  for await (const chunk of readableStream) {
    data += chunk;
  }
  const readEnd = Date.now();
  const duration = readEnd - readBegin;

  console.log('data-length', data.length);
  console.log('duration  ', duration);
  console.log('All data read:');

  return {
    readBegin,
    readEnd,
    duration,
  };
}

describe('rateLimiter  data transfer in node.js environment', () => {
  it(
    'putObject with limiter',
    async () => {
      const client = new TOS(tosOptions);
      const key = `putObject-with-limiter-${objectKey10M}`;

      const now = Date.now();
      await client.putObjectFromFile({
        key,
        filePath: objectPath10M,
        rateLimiter: createDefaultRateLimiter(commonCapacity, commonRate),
      });
      const duration = Date.now() - now;
      expect(duration).toBeGreaterThan(commonLimiterTime);

      const nowWithoutLimiter = Date.now();
      await client.putObjectFromFile({
        key,
        filePath: objectPath10M,
      });

      const durationWithoutLimiter = Date.now() - nowWithoutLimiter;
      console.log(
        '%c [ durationWithoutLimiter ]-107',
        'font-size:13px; background:pink; color:#bf2c9f;',
        durationWithoutLimiter
      );
      expect(durationWithoutLimiter).toBeLessThan(duration);
    },
    NEVER_TIMEOUT
  );

  it(
    'appendObject with limiter',
    async () => {
      const client = new TOS(tosOptions);
      const key = `appendObject-with-limiter-${objectKey10M}`;

      const now = Date.now();
      const { data: appendResultData } = await client.appendObject({
        key,
        body: fs.createReadStream(objectPath10M),
        offset: 0,
        storageClass: StorageClassType.StorageClassStandard,
        contentLength: 10 * 1024 * 1024,
        rateLimiter: createDefaultRateLimiter(commonCapacity, commonRate),
      });
      const duration = Date.now() - now;
      expect(duration).toBeGreaterThan(commonLimiterTime);

      const nowWithoutLimiter = Date.now();
      await client.appendObject({
        key,
        offset: appendResultData.nextAppendOffset,
        body: fs.createReadStream(objectPath10M),
        storageClass: StorageClassType.StorageClassStandard,
        contentLength: 10 * 1024 * 1024,
      });

      const durationWithoutLimiter = Date.now() - nowWithoutLimiter;

      expect(durationWithoutLimiter).toBeLessThan(duration);
    },
    NEVER_TIMEOUT
  );

  it(
    'uploadFile with limiter',
    async () => {
      const client = new TOS(tosOptions);
      const key = `uploadFile-with-limiter-${objectKey10M}`;

      const now = Date.now();
      await client.uploadFile({
        key,
        file: objectPath10M,
        rateLimiter: createDefaultRateLimiter(commonCapacity, commonRate),
      });
      const duration = Date.now() - now;
      expect(duration).toBeGreaterThan(commonLimiterTime);

      const nowWithoutLimiter = Date.now();
      await client.uploadFile({
        key,
        file: objectPath10M,
      });

      const durationWithoutLimiter = Date.now() - nowWithoutLimiter;
      console.log(
        '%c [ duration ]-150',
        'font-size:13px; background:pink; color:#bf2c9f;',
        duration
      );
      console.log(
        '%c [ durationWithoutLimiter ]-150',
        'font-size:13px; background:pink; color:#bf2c9f;',
        durationWithoutLimiter
      );
      expect(durationWithoutLimiter).toBeLessThan(duration);
    },
    NEVER_TIMEOUT
  );

  it(
    'getObject with limiter',
    async () => {
      const client = new TOS(tosOptions);
      const key = `getObject-with-limiter-${objectKey10M}`;
      await client.putObjectFromFile({
        key,
        filePath: objectPath10M,
      });

      const now = Date.now();
      const res = await client.getObjectV2({
        key,
        headers: {},
        rateLimiter: createDefaultRateLimiter(commonCapacity, commonCapacity),
      });
      const { duration } = await readAllData(res.data.content, now);

      expect(+res.headers['content-length']!).toBe(10485760);
      expect(duration).toBeGreaterThan(commonLimiterTime);

      const nowWithoutLimiter = Date.now();
      const resWithoutLimiter = await client.getObjectV2({
        key,
        headers: {},
      });
      const { duration: durationWithoutLimiter } = await readAllData(
        resWithoutLimiter.data.content,
        nowWithoutLimiter
      );

      // 限速的大于不限速的耗时
      expect(durationWithoutLimiter).toBeLessThan(duration);
    },
    NEVER_TIMEOUT
  );

  it(
    'downloadFile with limiter',
    async () => {
      const client = new TOS(tosOptions);
      const key = `downloadFile-with-limiter-${objectKey10M}`;
      await client.putObjectFromFile({
        key,
        filePath: objectPath10M,
      });

      const now = Date.now();
      await client.downloadFile({
        key,
        filePath: downloadFileDir,
        rateLimiter: createDefaultRateLimiter(commonCapacity, commonRate),
      });
      const duration = Date.now() - now;
      expect(duration).toBeGreaterThan(commonLimiterTime);

      const nowWithoutLimiter = Date.now();
      await client.downloadFile({
        key,
        filePath: downloadFileDir,
      });

      const durationWithoutLimiter = Date.now() - nowWithoutLimiter;
      console.log(
        '%c [ duration ]-150',
        'font-size:13px; background:pink; color:#bf2c9f;',
        duration
      );
      console.log(
        '%c [ durationWithoutLimiter ]-150',
        'font-size:13px; background:pink; color:#bf2c9f;',
        durationWithoutLimiter
      );
      expect(durationWithoutLimiter).toBeLessThan(duration);
    },
    NEVER_TIMEOUT
  );
});
