/**
 * Security violations related to AWS S3 (CDK and SDK patterns).
 */

declare class Bucket {
  constructor(scope: any, id: string, props: any);
  grantPublicAccess(): void;
}
declare const BucketAccessControl: { PUBLIC_READ: string };

// VIOLATION: security/deterministic/aws-s3-bucket-access
export function s3BucketAccess() {
  const bucket = new Bucket({}, 'MyBucket', {
    versioned: true,
    enforceSSL: true,
    blockPublicAccess: 'BLOCK_ALL',
  });
  bucket.grantPublicAccess();
}

// VIOLATION: security/deterministic/aws-s3-insecure-http
export function s3InsecureHttp(scope: any) {
  return new Bucket(scope, 'Insecure', {
    versioned: true,
    enforceSSL: false,
  });
}

// VIOLATION: security/deterministic/aws-s3-no-versioning
export function s3NoVersioning(scope: any) {
  return new Bucket(scope, 'NoVersion', {
    enforceSSL: true,
    versioned: false,
  });
}

// VIOLATION: security/deterministic/aws-s3-public-access
export function s3PublicAccess(scope: any) {
  return new Bucket(scope, 'Public', {
    versioned: true,
    enforceSSL: true,
    accessControl: BucketAccessControl.PUBLIC_READ,
  });
}

// VIOLATION: security/deterministic/s3-insecure-http
export function s3ClientInsecureHttp() {
  const S3 = class { constructor(opts: any) {} };
  return new S3({ ssl: false, region: 'us-east-1' });
}

// VIOLATION: security/deterministic/s3-missing-bucket-owner
export function s3MissingBucketOwner() {
  const s3 = { putObject: (params: any) => params };
  return s3.putObject({
    Bucket: 'my-bucket',
    Key: 'data.json',
    Body: '{}',
  });
}

// VIOLATION: security/deterministic/s3-public-bucket-access
export function s3PublicBucketAccess() {
  const s3 = { putPublicAccessBlock: (params: any) => params };
  return s3.putPublicAccessBlock({
    Bucket: 'my-bucket',
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: false,
      BlockPublicPolicy: true,
    },
  });
}

// VIOLATION: security/deterministic/s3-unrestricted-access
export function s3UnrestrictedAccess() {
  const bucketPolicy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::my-bucket/*"}]}';
  return bucketPolicy;
}
