/**
 * Security violations related to AWS IAM policies (CDK-style).
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

// VIOLATION: security/deterministic/aws-iam-all-privileges
export function iamAllPrivileges() {
  return new PolicyStatement({
    actions: ['*'],
    resources: ['arn:aws:s3:::my-bucket'],
  });
}

// VIOLATION: security/deterministic/aws-iam-all-resources
export function iamAllResources() {
  return new PolicyStatement({
    actions: ['s3:GetObject'],
    resources: ['*'],
  });
}

// VIOLATION: security/deterministic/aws-iam-privilege-escalation
export function iamPrivilegeEscalation() {
  return new PolicyStatement({
    actions: ['iam:*'],
    resources: ['*'],
  });
}

// VIOLATION: security/deterministic/aws-iam-public-access
export function iamPublicAccessWildcard() {
  return new PolicyStatement({
    principal: { AWS: '*' },
    actions: ['s3:GetObject'],
    resources: ['arn:aws:s3:::my-bucket/*'],
  });
}

// VIOLATION: security/deterministic/aws-iam-public-access
export function iamPublicAccessAny() {
  return new AnyPrincipal();
}
