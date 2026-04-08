/**
 * S3 bucket configurations -- secure CDK and SDK patterns.
 */

declare class Bucket {
  constructor(scope: unknown, id: string, props: Record<string, unknown>);
}
declare const BucketAccessControl: { PRIVATE: string };
declare const BlockPublicAccess: { BLOCK_ALL: string };

export function createSecureBucket(): Bucket {
  return new Bucket({}, 'SecureAssets', {
    versioned: true,
    enforceSSL: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  });
}

export function createSslBucket(scope: unknown): Bucket {
  return new Bucket(scope, 'DataBucket', {
    versioned: true,
    enforceSSL: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  });
}

export function createVersionedBucket(scope: unknown): Bucket {
  return new Bucket(scope, 'LogBucket', {
    enforceSSL: true,
    versioned: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  });
}

export function createPrivateBucket(scope: unknown): Bucket {
  return new Bucket(scope, 'PrivateBucket', {
    versioned: true,
    enforceSSL: true,
    accessControl: BucketAccessControl.PRIVATE,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  });
}

export function createS3ClientSecure(): { ssl: boolean; region: string } {
  return { ssl: true, region: 'us-east-1' };
}

export function uploadWithOwner(): Record<string, string> {
  const s3 = { putObject: (params: Record<string, string>) => params };
  return s3.putObject({
    Bucket: 'my-bucket',
    Key: 'data.json',
    Body: '{}',
    ExpectedBucketOwner: '123456789012',
  });
}

export function enablePublicBlock(): Record<string, unknown> {
  const s3 = { putPublicAccessBlock: (params: Record<string, unknown>) => params };
  return s3.putPublicAccessBlock({
    Bucket: 'my-bucket',
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
}

export function restrictedBucketPolicy(): string {
  return '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::123456789:role/app-role"},"Action":"s3:GetObject","Resource":"arn:aws:s3:::my-bucket/*"}]}';
}
