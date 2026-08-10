/**
 * AWS resource definitions — encryption, networking, compute.
 */
import { Queue } from 'aws-cdk-lib/aws-sqs';

declare class RestApi {
  constructor(scope: any, id: string, props: any);
}
declare const AuthorizationType: { NONE: string };
declare class Volume {
  constructor(scope: any, id: string, props: any);
}
declare class FileSystem {
  constructor(scope: any, id: string, props: any);
}
declare class Domain {
  constructor(scope: any, id: string, props: any);
}
declare class DatabaseInstance {
  constructor(scope: any, id: string, props: any);
}
declare class CfnNotebookInstance {
  constructor(scope: any, id: string, props: any);
}
declare class Topic {
  constructor(scope: any, id: string, props: any);
}
declare class Queue {
  constructor(scope: any, id: string, props: any);
}
declare const Peer: { anyIpv4: () => any };
declare const Port: { tcp: (port: number) => any };

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createPublicApi(scope: any) {
  // VIOLATION: security/deterministic/aws-public-api
  return new RestApi(scope, 'PublicApi', {
    defaultMethodOptions: {
      authorizationType: AuthorizationType.NONE,
    },
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createPublicDatabase() {
  // VIOLATION: security/deterministic/aws-public-resource
  return {
    publiclyAccessible: true,
    engine: 'postgres',
  };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnencryptedVolume(scope: any) {
  // VIOLATION: security/deterministic/aws-unencrypted-ebs
  return new Volume(scope, 'Vol', {
    availabilityZone: 'us-east-1a',
    encrypted: false,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnencryptedFs(scope: any) {
  // VIOLATION: security/deterministic/aws-unencrypted-efs
  return new FileSystem(scope, 'Efs', {
    encrypted: false,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnencryptedSearch(scope: any) {
  // VIOLATION: security/deterministic/aws-unencrypted-opensearch
  return new Domain(scope, 'Search', {
    version: 'OpenSearch_2.5',
    encryptionAtRest: { enabled: false },
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnencryptedDb(scope: any) {
  // VIOLATION: security/deterministic/aws-unencrypted-rds
  return new DatabaseInstance(scope, 'Db', {
    engine: 'postgres',
    storageEncrypted: false,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnencryptedNotebook(scope: any) {
  // VIOLATION: security/deterministic/aws-unencrypted-sagemaker
  return new CfnNotebookInstance(scope, 'Notebook', {
    instanceType: 'ml.t2.medium',
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnencryptedTopic(scope: any) {
  // VIOLATION: security/deterministic/aws-unencrypted-sns
  return new Topic(scope, 'Notifications', {
    displayName: 'Alerts',
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUnencryptedQueue(scope: any) {
  // VIOLATION: security/deterministic/aws-unencrypted-sqs
  return new Queue(scope, 'Jobs', {
    visibilityTimeout: 300,
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function openSshAccess() {
  const sg = { addIngressRule: (...args: any[]) => {} };
  // VIOLATION: security/deterministic/aws-unrestricted-admin-ip
  sg.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH access');
}
