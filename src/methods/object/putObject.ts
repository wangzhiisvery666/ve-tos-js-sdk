import TOSBase from '../base';
import { normalizeHeaders, safeAwait } from '../../utils';
import { Acl, DataTransferStatus, DataTransferType } from '../../interface';
import TosClientError from '../../TosClientError';
import * as fsp from '../../nodejs/fs-promises';
import fs, { Stats } from 'fs';
import { Readable } from 'stream';
import { getSize, getNewBodyConfig } from './utils';
import { retryNamespace } from '../../axios';

export interface PutObjectInput {
  bucket?: string;
  key: string;
  /**
   * body is empty buffer if it's falsy.
   */
  body?: File | Blob | Buffer | NodeJS.ReadableStream;

  dataTransferStatusChange?: (status: DataTransferStatus) => void;

  /**
   * the simple progress feature
   * percent is [0, 1].
   *
   * since putObject is stateless, so if `putObject` fail and you retry it,
   * `percent` will start from 0 again rather than from the previous value.
   * if you need `percent` start from the previous value, you can use `uploadFile` instead.
   */
  progress?: (percent: number) => void;

  headers?: {
    [key: string]: string | undefined;
    'content-length'?: string;
    'content-type'?: string;
    'content-md5'?: string;
    'cache-control'?: string;
    expires?: string;
    'x-tos-acl'?: Acl;
    'x-tos-grant-full-control'?: string;
    'x-tos-grant-read'?: string;
    'x-tos-grant-read-acp'?: string;
    'x-tos-grant-write-acp'?: string;
    'x-tos-server-side-encryption-customer-algorithm'?: string;
    'x-tos-server-side-encryption-customer-key'?: string;
    'x-tos-server-side-encryption-customer-key-md5'?: string;
    'x-tos-website-redirect-location'?: string;
    'x-tos-storage-class'?: string;
    'x-tos-server-side-encryption'?: string;
  };
}

interface PutObjectInputInner extends PutObjectInput {
  makeRetryStream?: () => Readable;
}

export interface PutObjectOutput {
  'x-tos-server-side-encryption-customer-algorithm'?: string;
  'x-tos-server-side-encryption-customer-key-md5'?: string;
  'x-tos-version-id'?: string;
  'x-tos-hash-crc64ecma'?: string;
  'x-tos-server-side-encryption'?: string;
}

export async function putObject(this: TOSBase, input: PutObjectInput | string) {
  return _putObject.call(this, input);
}

export async function _putObject(
  this: TOSBase,
  input: PutObjectInputInner | string
) {
  input = this.normalizeObjectInput(input);
  const headers = normalizeHeaders(input.headers);
  this.setObjectContentTypeHeader(input, headers);

  const totalSize = getSize(input.body, headers);
  const totalSizeValid = totalSize != null;

  if (!totalSizeValid && (input.dataTransferStatusChange || input.progress)) {
    console.warn(
      `Don't get totalSize of putObject's body, the \`dataTransferStatusChange\` and \`progress\` callback will not trigger. You can use \`putObjectFromFile\` instead`
    );
  }

  let consumedBytes = 0;
  const { dataTransferStatusChange, progress } = input;
  const triggerDataTransfer = (
    type: DataTransferType,
    rwOnceBytes: number = 0
  ) => {
    // request cancel will make rwOnceBytes < 0 in browser
    if (!totalSizeValid || rwOnceBytes < 0) {
      return;
    }
    if (!dataTransferStatusChange && !progress) {
      return;
    }
    consumedBytes += rwOnceBytes;

    dataTransferStatusChange?.({
      type,
      rwOnceBytes,
      consumedBytes,
      totalBytes: totalSize,
    });
    const progressValue = (() => {
      if (totalSize === 0) {
        if (type === DataTransferType.Succeed) {
          return 1;
        }
        return 0;
      }
      return consumedBytes / totalSize;
    })();
    if (progressValue === 1) {
      if (type === DataTransferType.Succeed) {
        progress?.(progressValue);
      } else {
        // not exec progress
      }
    } else {
      progress?.(progressValue);
    }
  };

  const bodyConfig = getNewBodyConfig({
    body: input.body,
    totalSize,
    dataTransferCallback: n => triggerDataTransfer(DataTransferType.Rw, n),
    makeRetryStream: input.makeRetryStream,
  });

  triggerDataTransfer(DataTransferType.Started);
  const [err] = await safeAwait(
    this.fetchObject<PutObjectOutput>(
      input,
      'PUT',
      {},
      headers,
      bodyConfig.body,
      {
        handleResponse: res => res.headers,
        axiosOpts: {
          [retryNamespace]: {
            beforeRetry: () => {
              consumedBytes = 0;
            },
            makeRetryStream: bodyConfig.makeRetryStream,
          },
          onUploadProgress: event => {
            triggerDataTransfer(
              DataTransferType.Rw,
              event.loaded - consumedBytes
            );
          },
        },
      }
    )
  );

  if (err) {
    triggerDataTransfer(DataTransferType.Failed);
    throw err;
  }

  triggerDataTransfer(DataTransferType.Succeed);
}

interface PutObjectFromFileInput extends Omit<PutObjectInput, 'body'> {
  filePath: string;
}

export async function putObjectFromFile(
  this: TOSBase,
  input: PutObjectFromFileInput
): Promise<void> {
  const normalizedHeaders = normalizeHeaders(input.headers);
  if (process.env.TARGET_ENVIRONMENT !== 'node') {
    throw new TosClientError(
      "putObjectFromFile doesn't support in browser environment"
    );
  }

  if (!normalizedHeaders['content-length']) {
    const stats: Stats = await fsp.stat(input.filePath);
    normalizedHeaders['content-length'] = `${stats.size}`;
  }
  const makeRetryStream = () => {
    const stream = fs.createReadStream(input.filePath);
    return stream;
  };

  return _putObject.call(this, {
    ...input,
    body: makeRetryStream(),
    headers: normalizedHeaders,
    makeRetryStream,
  });
}

export default putObject;
