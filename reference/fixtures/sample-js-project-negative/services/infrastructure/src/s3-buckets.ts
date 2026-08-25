/**
 * S3 bucket configurations — CDK and SDK patterns.
 */

declare class Bucket {
  constructor(scope: any, id: string, props: any);
  grantPublicAccess(): void;
}
declare const BucketAccessControl: { PUBLIC_READ: string };

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createPublicBucket() {
  const bucket = new Bucket({}, 'PublicAssets', {
    versioned: true,
    enforceSSL: true,
    blockPublicAccess: 'BLOCK_ALL',
  });
  // VIOLATION: security/deterministic/aws-s3-bucket-access
  bucket.grantPublicAccess();
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createInsecureBucket(scope: any) {
  // VIOLATION: security/deterministic/aws-s3-insecure-http
  return new Bucket(scope, 'DataBucket', {
    versioned: true,
    enforceSSL: false,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnversionedBucket(scope: any) {
  // VIOLATION: security/deterministic/aws-s3-no-versioning
  return new Bucket(scope, 'LogBucket', {
    enforceSSL: true,
    versioned: false,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createPublicReadBucket(scope: any) {
  // VIOLATION: security/deterministic/aws-s3-public-access
  return new Bucket(scope, 'PublicRead', {
    versioned: true,
    enforceSSL: true,
    accessControl: BucketAccessControl.PUBLIC_READ,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createS3ClientInsecure() {
  const S3 = class { constructor(opts: any) {} };
  // VIOLATION: security/deterministic/s3-insecure-http
  return new S3({ ssl: false, region: 'us-east-1' });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function uploadWithoutOwner() {
  const s3 = { putObject: (params: any) => params };
  // VIOLATION: security/deterministic/s3-missing-bucket-owner
  return s3.putObject({
    Bucket: 'my-bucket',
    Key: 'data.json',
    Body: '{}',
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function disablePublicBlock() {
  const s3 = { putPublicAccessBlock: (params: any) => params };
  // VIOLATION: security/deterministic/s3-public-bucket-access
  return s3.putPublicAccessBlock({
    Bucket: 'my-bucket',
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: false,
      BlockPublicPolicy: true,
    },
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function wildcardBucketPolicy() {
  // VIOLATION: security/deterministic/s3-unrestricted-access
  const bucketPolicy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::my-bucket/*"}]}';
  return bucketPolicy;
}
