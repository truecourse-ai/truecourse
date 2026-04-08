/**
 * AWS IAM policy definitions -- least-privilege policies.
 */

declare class PolicyStatement {
  constructor(props: Record<string, unknown>);
}

const S3_GET_OBJECT = 's3:GetObject';
const BUCKET_RESOURCE = 'arn:aws:s3:::my-bucket/*';

export function createDataAccessPolicy(): PolicyStatement {
  return new PolicyStatement({
    actions: [S3_GET_OBJECT, 's3:PutObject'],
    resources: [BUCKET_RESOURCE],
  });
}

export function createReadPolicy(): PolicyStatement {
  return new PolicyStatement({
    actions: [S3_GET_OBJECT],
    resources: [BUCKET_RESOURCE],
  });
}

export function createLimitedAdminPolicy(): PolicyStatement {
  return new PolicyStatement({
    actions: ['iam:ListUsers', 'iam:GetUser'],
    resources: ['arn:aws:iam::123456789:user/*'],
  });
}

export function createRestrictedBucketPolicy(): PolicyStatement {
  return new PolicyStatement({
    principal: { AWS: 'arn:aws:iam::123456789:role/app-role' },
    actions: [S3_GET_OBJECT],
    resources: [BUCKET_RESOURCE],
  });
}

export function createScopedPolicy(): PolicyStatement {
  return new PolicyStatement({
    actions: [S3_GET_OBJECT],
    resources: ['arn:aws:s3:::my-bucket/public/*'],
    conditions: { StringEquals: { 'aws:PrincipalOrgID': 'o-abc123' } },
  });
}
