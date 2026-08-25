/**
 * AWS IAM policy definitions for the application stack.
 */

declare class PolicyStatement {
  constructor(props: any);
}
declare class ManagedPolicy {
  constructor(props: any);
}
declare class AnyPrincipal {
  constructor();
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createDataAccessPolicy() {
  // VIOLATION: security/deterministic/aws-iam-all-privileges
  return new PolicyStatement({
    actions: ['*'],
    resources: ['arn:aws:s3:::my-bucket'],
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createReadPolicy() {
  // VIOLATION: security/deterministic/aws-iam-all-resources
  return new PolicyStatement({
    actions: ['s3:GetObject'],
    resources: ['*'],
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createAdminPolicy() {
  // VIOLATION: security/deterministic/aws-iam-privilege-escalation
  return new PolicyStatement({
    actions: ['iam:*'],
    resources: ['*'],
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createPublicBucketPolicy() {
  // VIOLATION: security/deterministic/aws-iam-public-access
  return new PolicyStatement({
    principal: { AWS: '*' },
    actions: ['s3:GetObject'],
    resources: ['arn:aws:s3:::my-bucket/*'],
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createAnyPrincipalPolicy() {
  // VIOLATION: security/deterministic/aws-iam-public-access
  return new AnyPrincipal();
}
