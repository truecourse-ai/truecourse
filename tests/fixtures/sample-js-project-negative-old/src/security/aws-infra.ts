/**
 * Security violations related to AWS infrastructure (CDK-style constructs).
 */

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

// VIOLATION: security/deterministic/aws-public-api
export function publicApiGateway(scope: any) {
  return new RestApi(scope, 'PublicApi', {
    defaultMethodOptions: {
      authorizationType: AuthorizationType.NONE,
    },
  });
}

// VIOLATION: security/deterministic/aws-public-resource
export function publicResource() {
  return {
    publiclyAccessible: true,
    engine: 'postgres',
  };
}

// VIOLATION: security/deterministic/aws-unencrypted-ebs
export function unencryptedEbs(scope: any) {
  return new Volume(scope, 'Vol', {
    availabilityZone: 'us-east-1a',
    encrypted: false,
  });
}

// VIOLATION: security/deterministic/aws-unencrypted-efs
export function unencryptedEfs(scope: any) {
  return new FileSystem(scope, 'Efs', {
    encrypted: false,
  });
}

// VIOLATION: security/deterministic/aws-unencrypted-opensearch
export function unencryptedOpenSearch(scope: any) {
  return new Domain(scope, 'Search', {
    version: 'OpenSearch_2.5',
    encryptionAtRest: { enabled: false },
  });
}

// VIOLATION: security/deterministic/aws-unencrypted-rds
export function unencryptedRds(scope: any) {
  return new DatabaseInstance(scope, 'Db', {
    engine: 'postgres',
    storageEncrypted: false,
  });
}

// VIOLATION: security/deterministic/aws-unencrypted-sagemaker
export function unencryptedSagemaker(scope: any) {
  return new CfnNotebookInstance(scope, 'Notebook', {
    instanceType: 'ml.t2.medium',
  });
}

// VIOLATION: security/deterministic/aws-unencrypted-sns
export function unencryptedSns(scope: any) {
  return new Topic(scope, 'Notifications', {
    displayName: 'Alerts',
  });
}

// VIOLATION: security/deterministic/aws-unencrypted-sqs
export function unencryptedSqs(scope: any) {
  return new Queue(scope, 'Jobs', {
    visibilityTimeout: 300,
  });
}

// VIOLATION: security/deterministic/aws-unrestricted-admin-ip
export function unrestrictedAdminIp() {
  const sg = { addIngressRule: (...args: any[]) => {} };
  sg.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH access');
}
