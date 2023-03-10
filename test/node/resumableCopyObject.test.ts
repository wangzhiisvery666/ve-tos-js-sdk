import axios from 'axios';
import TOS, { isCancel } from '../../src/browser-index';
import { deleteBucket, sleepCache, NEVER_TIMEOUT, streamToBuf } from '../utils';
import {
  testBucketName,
  isNeedDeleteBucket,
  tosOptions,
} from '../utils/options';
import * as fsPromises from '../../src/nodejs/fs-promises';
import path from 'path';
import {
  checkpointsDir,
  initAutoGeneratedObjects,
  objectKey100M,
  objectKey10M,
  objectKey1K,
  objectKeyEmpty,
  objectPath100M,
  objectPath10M,
  objectPath1K,
  objectPathEmpty,
} from './utils';
import {
  ResumableCopyEventType,
  ResumableCopyEvent,
  ResumableCopyCheckpointRecord,
} from '../../src/methods/object/multipart/resumableCopyObject';
import { StorageClassType } from '../../src';

initAutoGeneratedObjects();

const objectKey10MSpecialName = `10M 🍡对象（!-_.*()/&$@=;:+ ,?\{^}%\`]>[~<#|'"）! ~ * ' ( )%2`;
const objectKey0MSpecialName = `0M 🍡对象（!-_.*()/&$@=;:+ ,?\{^}%\`]>[~<#|'"）! ~ * ' ( )%2`;

describe('resumableCopyObject in node.js environment', () => {
  beforeAll(async done => {
    const client = new TOS(tosOptions);
    // clear all bucket
    const { data: buckets } = await client.listBuckets();
    for (const bucket of buckets.Buckets) {
      if (isNeedDeleteBucket(bucket.Name)) {
        try {
          await deleteBucket(client, bucket.Name);
        } catch (err) {
          console.log('a: ', err);
        }
      }
    }
    // create bucket
    await client.createBucket({
      bucket: testBucketName,
    });
    await Promise.all([
      client.uploadFile({ file: objectPathEmpty, key: objectKeyEmpty }),
      client.uploadFile({ file: objectPath1K, key: objectKey1K }),
      client.uploadFile({ file: objectPath10M, key: objectKey10M }),
      client.uploadFile({ file: objectPath100M, key: objectKey100M }),
    ]);
    await client.resumableCopyObject({
      srcBucket: tosOptions.bucket,
      srcKey: objectKey10M,
      key: objectKey10MSpecialName,
    });
    await client.resumableCopyObject({
      srcBucket: tosOptions.bucket,
      srcKey: objectKeyEmpty,
      key: objectKey0MSpecialName,
    });
    await sleepCache();
    done();
  }, NEVER_TIMEOUT);
  // afterAll(async done => {
  //   const client = new TOS(tosOptions);
  //   console.log('delete bucket.....');
  //   // delete bucket
  //   deleteBucket(client, testBucketName);
  //   done();
  // }, NEVER_TIMEOUT);

  it(
    'resumableCopyObject small file without checkpoint',
    async () => {
      const srcKey = objectKey1K;
      const key = `copy_${srcKey}_without_checkpoint`;
      const client = new TOS(tosOptions);
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
      });
      const { data } = await client.headObject(key);
      expect(+data['content-length'] === 1024).toBeTruthy();
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject empty object pass headers',
    async () => {
      const srcKey = objectKeyEmpty;
      const key = `copy_${srcKey}_empty_object_pass_headers`;
      const client = new TOS(tosOptions);
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        headers: {
          'content-type': 'image/tiff',
        },
      });
      const { data, headers } = await client.headObject(key);
      expect(+data['content-length'] === 0).toBeTruthy();
      expect(headers['content-type']).toBe('image/tiff');
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject pass headers',
    async () => {
      const srcKey = objectKey1K;
      const key = `copy_${srcKey}_pass_headers`;
      const client = new TOS(tosOptions);
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        headers: {
          'content-type': 'image/tiff',
        },
      });
      const { data, headers } = await client.headObject(key);
      expect(+data['content-length'] === 1024).toBeTruthy();
      expect(headers['content-type']).toBe('image/tiff');
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject pass CreateMultipart input',
    async () => {
      const srcKey = objectKey1K;
      const key = `copy_${srcKey}_pass_createMultipart_headers`;
      const client = new TOS(tosOptions);
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        serverSideEncryption: 'AES256',
        storageClass: StorageClassType.StorageClassIa,
        headers: {
          'content-type': 'image/tiff',
        },
      });
      const { headers } = await client.headObject(key);
      expect(headers['x-tos-storage-class']).toBe(StorageClassType.StorageClassIa);
      expect(headers['x-tos-server-side-encryption']).toBe('AES256');
      expect(headers['content-type']).toBe('image/tiff');
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject without checkpoint',
    async () => {
      const srcKey = objectKey100M;
      const key = `copy_${srcKey}-without-checkpoint`;
      const client = new TOS(tosOptions);
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
      });
      const { data } = await client.headObject(key);
      expect(+data['content-length'] === 100 * 1024 * 1024).toBeTruthy();
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject small file with checkpoint file',
    async () => {
      const srcKey = objectKey1K;
      const key = `copy_${srcKey}_with_checkpoint_file`;
      const client = new TOS(tosOptions);
      const copyEventListenerFn = jest.fn();
      const progressFn = jest.fn();
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        checkpoint: checkpointsDir,
        copyEventListener: copyEventListenerFn,
        progress: progressFn,
      });

      expect(copyEventListenerFn.mock.calls.length).toBe(3);
      expect(copyEventListenerFn.mock.calls[0][0].type).toBe(
        ResumableCopyEventType.createMultipartUploadSucceed
      );
      const checkpointFilePath =
        copyEventListenerFn.mock.calls[0][0].checkpointFile;
      expect(checkpointFilePath).not.toBeUndefined();
      expect(copyEventListenerFn.mock.calls[0][0].type).toBe(
        ResumableCopyEventType.createMultipartUploadSucceed
      );

      expect(progressFn.mock.calls.length).toBe(2);
      expect(progressFn.mock.calls[0][0]).toBe(0);
      expect(progressFn.mock.calls[1][0]).toBe(1);

      const { data } = await client.getObjectV2(key);
      expect((await streamToBuf(data.content)).length === 1024).toBeTruthy();
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject with specific checkpoint filename',
    async () => {
      const srcKey = objectKey1K;
      const key = `copy_${srcKey}_with_specific_checkpoint_file`;
      const client = new TOS(tosOptions);
      const copyEventListenerFn = jest.fn();
      const filepath = path.resolve(
        checkpointsDir,
        'specific_checkpoint_file.json'
      );

      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        checkpoint: filepath,
        copyEventListener: copyEventListenerFn,
      });

      expect(copyEventListenerFn.mock.calls[0][0].checkpointFile).toBe(
        filepath
      );
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject pause and resume with checkpoint',
    async () => {
      const srcKey = objectKey100M;
      const key = `copy_${srcKey}-pause-and-resume-with-checkpoint`;
      const client = new TOS(tosOptions);
      const cpFilepath = path.resolve(
        checkpointsDir,
        'pause-and-resume-checkpoint.json'
      );
      await fsPromises.rm(cpFilepath).catch(() => {});

      let resolve = (_v?: unknown) => {};
      const p = new Promise(r => (resolve = r));
      const pausePartCount = 4;
      const allPartCount = 10;
      let currentPartCount = 0;
      const source = axios.CancelToken.source();
      const copyEventListener = (e: ResumableCopyEvent) => {
        if (e.type === ResumableCopyEventType.uploadPartCopySucceed) {
          ++currentPartCount;

          if (currentPartCount === pausePartCount) {
            source.cancel('');
            setTimeout(resolve, 1000);
          }
        }
      };

      const uploadFilePromise = client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        checkpoint: cpFilepath,
        copyEventListener,
        partSize: (100 * 1024 * 1024) / allPartCount,
        cancelToken: source.token,
      });
      await uploadFilePromise.catch(err => {
        if (!isCancel(err)) {
          console.log(err);
        }
        expect(isCancel(err)).toBeTruthy();
      });
      const checkpointFileContent: ResumableCopyCheckpointRecord = require(cpFilepath);
      const uploadedPartCount = checkpointFileContent.parts_info?.length || 0;

      // first write file, then call callback
      // so there maybe be more part
      expect(uploadedPartCount).toBeGreaterThanOrEqual(pausePartCount);

      await p;
      const copyEventListenerFn = jest.fn();
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        checkpoint: cpFilepath,
        copyEventListener: copyEventListenerFn,
      });

      expect(
        copyEventListenerFn.mock.calls.filter(
          it => it[0].type === ResumableCopyEventType.uploadPartCopySucceed
        ).length
      ).toBe(allPartCount - uploadedPartCount);
      expect(
        copyEventListenerFn.mock.calls.filter(
          it =>
            it[0].type === ResumableCopyEventType.completeMultipartUploadSucceed
        ).length
      ).toBe(1);

      const { data } = await client.headObject(key);
      expect(+data['content-length'] === 100 * 1024 * 1024).toBeTruthy();
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject pause and resume with checkpoint when partNum is 3',
    async () => {
      const srcKey = objectKey100M;
      const key = `copy_${srcKey}-pause-and-resume-with-checkpoint-when-partNum-is-3`;
      const client = new TOS(tosOptions);
      const cpFilepath = path.resolve(
        checkpointsDir,
        'pause-and-resume-checkpoint-when-partNum-is-3.json'
      );
      await fsPromises.rm(cpFilepath).catch(() => {});

      let resolve = (_v?: unknown) => {};
      const p = new Promise(r => (resolve = r));
      const pausePartCount = 4;
      const allPartCount = 10;
      let currentPartCount = 0;
      const source = axios.CancelToken.source();
      const copyEventListener = (e: ResumableCopyEvent) => {
        if (e.type === ResumableCopyEventType.uploadPartCopySucceed) {
          ++currentPartCount;

          if (currentPartCount === pausePartCount) {
            source.cancel('');
            setTimeout(resolve, 1000);
          }
        }
      };

      const uploadFilePromise = client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        checkpoint: cpFilepath,
        copyEventListener,
        partSize: (100 * 1024 * 1024) / allPartCount,
        cancelToken: source.token,
        taskNum: 3,
      });
      await uploadFilePromise.catch(err => {
        if (!isCancel(err)) {
          console.log(err);
        }
        expect(isCancel(err)).toBeTruthy();
      });
      const checkpointFileContent: ResumableCopyCheckpointRecord = require(cpFilepath);
      const uploadedPartCount = checkpointFileContent.parts_info?.length || 0;

      // first write file, then call callback
      // so there maybe be more part
      expect(uploadedPartCount).toBeGreaterThanOrEqual(pausePartCount);

      await p;
      const copyEventListenerFn = jest.fn();
      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        checkpoint: cpFilepath,
        copyEventListener: copyEventListenerFn,
        taskNum: 3,
      });

      expect(
        copyEventListenerFn.mock.calls.filter(
          it => it[0].type === ResumableCopyEventType.uploadPartCopySucceed
        ).length
      ).toBe(allPartCount - uploadedPartCount);
      expect(
        copyEventListenerFn.mock.calls.filter(
          it =>
            it[0].type === ResumableCopyEventType.completeMultipartUploadSucceed
        ).length
      ).toBe(1);

      const { data } = await client.headObject(key);
      expect(+data['content-length'] === 100 * 1024 * 1024).toBeTruthy();
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject fetch this object after progress 100%',
    async () => {
      const srcKey = objectKey100M;
      const key = `copy_${srcKey}-fetch-after-100%`;
      const client = new TOS(tosOptions);
      let p2Resolve: any = null;
      let p2Reject: any = null;
      const p2 = new Promise((r1, r2) => {
        p2Resolve = r1;
        p2Reject = r2;
      });

      const p1 = client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        progress: async p => {
          try {
            if (p === 1) {
              const { data } = await client.headObject(key);
              expect(
                +data['content-length'] === 100 * 1024 * 1024
              ).toBeTruthy();
              p2Resolve();
            }
          } catch (err) {
            p2Reject(err);
          }
        },
      });

      await Promise.all([p1, p2]);
    },
    NEVER_TIMEOUT
  );

  it(
    'resumableCopyObject upload empty file',
    async () => {
      const srcKey = objectKeyEmpty;
      const key = `copy_${srcKey}_test-empty-file`;
      const client = new TOS(tosOptions);
      const progressFn = jest.fn();

      const { data } = await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
        progress: progressFn,
      });
      expect(data.Location).toBe(
        `https://${tosOptions.bucket}.${client.opts.endpoint}/${key}`
      );
      expect(data.Bucket).toBe(tosOptions.bucket);
      expect(data.Key).toBe(key);

      expect(progressFn.mock.calls.length).toBe(2);
      expect(progressFn.mock.calls[0][0]).toBe(0);
      expect(progressFn.mock.calls[1][0]).toBe(1);
      const { data: data2 } = await client.headObject(key);
      expect(+data2['content-length'] === 0).toBeTruthy();
    },
    NEVER_TIMEOUT
  );

  it(
    'copy for special key',
    async () => {
      const srcKey = objectKey10MSpecialName;
      const key = `copy_${srcKey}_test-chinese-source-key`;
      const client = new TOS(tosOptions);

      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey,
        key,
      });

      const { data: data2 } = await client.headObject(key);
      expect(+data2['content-length'] === 10 * 1024 * 1024).toBeTruthy();

      const srcKey0 = objectKey0MSpecialName;
      const key0 = `copy_${srcKey0}_test-chinese-source-key`;

      await client.resumableCopyObject({
        srcBucket: tosOptions.bucket,
        srcKey: srcKey0,
        key: key0,
      });

      const { data: data3 } = await client.headObject(key0);
      expect(+data3['content-length'] === 0).toBeTruthy();
    },
    NEVER_TIMEOUT
  );

  it('modify file after pause', async () => {}, NEVER_TIMEOUT);

  it(
    "partSize param is not equal to checkpoint file's partSize",
    async () => {},
    NEVER_TIMEOUT
  );

  // first upload part will fail
  it('uploadId of checkpoint file is aborted', async () => {}, NEVER_TIMEOUT);
});
