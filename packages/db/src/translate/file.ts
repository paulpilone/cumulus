import { ApiFile } from '@cumulus/types/api/files';

import { PostgresFile, PostgresFileRecord } from '../types/file';

const { parseS3Uri } = require('@cumulus/aws-client/S3');
const { removeNilProperties } = require('@cumulus/common/util');

const getBucket = (file: ApiFile): string | undefined => {
  if (file.bucket) return file.bucket;
  if (file.filename) return parseS3Uri(file.filename).Bucket;
  return undefined;
};

const getKey = (file: ApiFile) => {
  if (file.key) return file.key;
  if (file.filename) return parseS3Uri(file.filename).Key;
  return undefined;
};

// TODO deal with inonsistency between ApiGraunle type, schema and records
export const translatePostgresFileToApiFile = (
  filePgRecord: PostgresFileRecord
): Omit<ApiFile, 'granuleId'> => removeNilProperties({
  bucket: filePgRecord.bucket,
  checksum: filePgRecord.checksum_value,
  checksumType: filePgRecord.checksum_type,
  createdAt: filePgRecord.created_at.getTime(),
  fileName: filePgRecord.file_name,
  key: filePgRecord.key,
  //path: filePgRecord.path,
  size: filePgRecord.file_size ? Number.parseInt(filePgRecord.file_size, 10) : undefined,
  source: filePgRecord.source,
  updatedAt: filePgRecord.updated_at?.getTime(),
});

export const translateApiFiletoPostgresFile = (
  file: ApiFile
): Omit<PostgresFile, 'granule_cumulus_id'> => {
  const bucket = getBucket(file);
  const key = getKey(file);
  return {
    bucket,
    key,
    checksum_type: file.checksumType,
    checksum_value: file.checksum,
    file_name: file.fileName,
    file_size: file.size,
    path: file.path,
    source: file.source,
  };
};
