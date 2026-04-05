import type { CodeRuleVisitor } from '../../../types.js'

export { pythonSqlInjectionVisitor } from './sql-injection.js'
export { pythonEvalUsageVisitor } from './eval-usage.js'
export { pythonOsCommandInjectionVisitor } from './os-command-injection.js'
export { pythonWeakHashingVisitor } from './weak-hashing.js'
export { pythonUnverifiedCertificateVisitor } from './unverified-certificate.js'
export { pythonInsecureCookieVisitor, pythonCookieWithoutHttpOnlyVisitor } from './insecure-cookie.js'
export { pythonDisabledAutoEscapingVisitor } from './disabled-auto-escaping.js'
export { pythonWeakCipherVisitor } from './weak-cipher.js'
export { pythonWeakCryptoKeyVisitor } from './weak-crypto-key.js'
export { pythonWeakSslVisitor } from './weak-ssl.js'
export { pythonInsecureJwtVisitor } from './insecure-jwt.js'
export { pythonEncryptionInsecureModeVisitor } from './encryption-insecure-mode.js'
export { pythonUnverifiedHostnameVisitor } from './unverified-hostname.js'
export { pythonXmlXxeVisitor } from './xml-xxe.js'
export { pythonUnsafeUnzipVisitor } from './unsafe-unzip.js'
export { pythonFilePermissionsWorldAccessibleVisitor } from './file-permissions-world-accessible.js'
export { pythonConfidentialInfoLoggingVisitor } from './confidential-info-logging.js'
export { pythonProductionDebugEnabledVisitor } from './production-debug-enabled.js'
export { pythonInsecureRandomVisitor } from './insecure-random.js'
export { pythonSubprocessSecurityVisitor } from './subprocess-security.js'
export { pythonPartialPathExecutionVisitor } from './partial-path-execution.js'
export { pythonSslVersionUnsafeVisitor } from './ssl-version-unsafe.js'
export { pythonVulnerableLibraryImportVisitor } from './vulnerable-library-import.js'
export { pythonProcessStartNoShellVisitor } from './process-start-no-shell.js'
export { pythonNonOctalFilePermissionsVisitor } from './non-octal-file-permissions.js'
export { pythonUnsafeYamlLoadVisitor } from './unsafe-yaml-load.js'
export { pythonUnsafePickleUsageVisitor } from './unsafe-pickle-usage.js'
export { pythonSshNoHostKeyVerificationVisitor } from './ssh-no-host-key-verification.js'
export { pythonUnsafeTempFileVisitor } from './unsafe-temp-file.js'
export { pythonFlaskSecretKeyDisclosedVisitor } from './flask-secret-key-disclosed.js'
export { pythonDjangoRawSqlVisitor } from './django-raw-sql.js'
export { pythonUnsafeMarkupVisitor } from './unsafe-markup.js'
export { pythonLoggingConfigInsecureListenVisitor } from './logging-config-insecure-listen.js'
export { pythonUnsafeTorchLoadVisitor } from './unsafe-torch-load.js'
export { pythonParamikoCallVisitor } from './paramiko-call.js'
export { pythonSuspiciousUrlOpenVisitor } from './suspicious-url-open.js'
export { pythonRedosVulnerableRegexVisitor } from './redos-vulnerable-regex.js'
export { pythonFastapiFileUploadBodyVisitor } from './fastapi-file-upload-body.js'
export { pythonSnmpInsecureVersionVisitor } from './snmp-insecure-version.js'
export { pythonS3InsecureHttpVisitor } from './s3-insecure-http.js'
export { pythonS3UnrestrictedAccessVisitor } from './s3-unrestricted-access.js'
export { pythonLongTermAwsKeysInCodeVisitor } from './long-term-aws-keys-in-code.js'
export { pythonWildcardInOsCommandVisitor } from './wildcard-in-os-command.js'
export { pythonAwsIamOverlyBroadPolicyVisitor, pythonAwsIamAllPrivilegesVisitor } from './aws-iam-overly-broad-policy.js'
export { pythonAwsIamAllResourcesVisitor } from './aws-iam-all-resources.js'
export { pythonAwsUnrestrictedAdminAccessVisitor } from './aws-unrestricted-admin-access.js'
export { pythonAwsPublicPolicyVisitor, pythonAwsPublicResourceVisitor } from './aws-public-policy.js'
export { pythonAwsUnrestrictedOutboundVisitor } from './aws-unrestricted-outbound.js'
export { pythonAwsUnencryptedEbsVisitor } from './aws-unencrypted-ebs.js'
export { pythonAwsUnencryptedRdsVisitor } from './aws-unencrypted-rds.js'
export { pythonAwsUnencryptedOpenSearchVisitor } from './aws-unencrypted-opensearch.js'
export { pythonAwsUnencryptedSageMakerVisitor } from './aws-unencrypted-sagemaker.js'
export { pythonAwsUnencryptedSnsVisitor } from './aws-unencrypted-sns.js'
export { pythonAwsUnencryptedSqsVisitor } from './aws-unencrypted-sqs.js'
export { pythonAwsUnencryptedEfsVisitor } from './aws-unencrypted-efs.js'
export { pythonAwsPublicApiVisitor } from './aws-public-api.js'
export { pythonAwsS3NoVersioningVisitor } from './aws-s3-no-versioning.js'
export { pythonSubprocessWithoutShellVisitor } from './subprocess-without-shell.js'
export { pythonProcessWithPartialPathVisitor } from './process-with-partial-path.js'
export { pythonSslNoVersionVisitor } from './ssl-no-version.js'

import { pythonSqlInjectionVisitor } from './sql-injection.js'
import { pythonEvalUsageVisitor } from './eval-usage.js'
import { pythonOsCommandInjectionVisitor } from './os-command-injection.js'
import { pythonWeakHashingVisitor } from './weak-hashing.js'
import { pythonUnverifiedCertificateVisitor } from './unverified-certificate.js'
import { pythonInsecureCookieVisitor, pythonCookieWithoutHttpOnlyVisitor } from './insecure-cookie.js'
import { pythonDisabledAutoEscapingVisitor } from './disabled-auto-escaping.js'
import { pythonWeakCipherVisitor } from './weak-cipher.js'
import { pythonWeakCryptoKeyVisitor } from './weak-crypto-key.js'
import { pythonWeakSslVisitor } from './weak-ssl.js'
import { pythonInsecureJwtVisitor } from './insecure-jwt.js'
import { pythonEncryptionInsecureModeVisitor } from './encryption-insecure-mode.js'
import { pythonUnverifiedHostnameVisitor } from './unverified-hostname.js'
import { pythonXmlXxeVisitor } from './xml-xxe.js'
import { pythonUnsafeUnzipVisitor } from './unsafe-unzip.js'
import { pythonFilePermissionsWorldAccessibleVisitor } from './file-permissions-world-accessible.js'
import { pythonConfidentialInfoLoggingVisitor } from './confidential-info-logging.js'
import { pythonProductionDebugEnabledVisitor } from './production-debug-enabled.js'
import { pythonInsecureRandomVisitor } from './insecure-random.js'
import { pythonSubprocessSecurityVisitor } from './subprocess-security.js'
import { pythonPartialPathExecutionVisitor } from './partial-path-execution.js'
import { pythonSslVersionUnsafeVisitor } from './ssl-version-unsafe.js'
import { pythonVulnerableLibraryImportVisitor } from './vulnerable-library-import.js'
import { pythonProcessStartNoShellVisitor } from './process-start-no-shell.js'
import { pythonNonOctalFilePermissionsVisitor } from './non-octal-file-permissions.js'
import { pythonUnsafeYamlLoadVisitor } from './unsafe-yaml-load.js'
import { pythonUnsafePickleUsageVisitor } from './unsafe-pickle-usage.js'
import { pythonSshNoHostKeyVerificationVisitor } from './ssh-no-host-key-verification.js'
import { pythonUnsafeTempFileVisitor } from './unsafe-temp-file.js'
import { pythonFlaskSecretKeyDisclosedVisitor } from './flask-secret-key-disclosed.js'
import { pythonDjangoRawSqlVisitor } from './django-raw-sql.js'
import { pythonUnsafeMarkupVisitor } from './unsafe-markup.js'
import { pythonLoggingConfigInsecureListenVisitor } from './logging-config-insecure-listen.js'
import { pythonUnsafeTorchLoadVisitor } from './unsafe-torch-load.js'
import { pythonParamikoCallVisitor } from './paramiko-call.js'
import { pythonSuspiciousUrlOpenVisitor } from './suspicious-url-open.js'
import { pythonRedosVulnerableRegexVisitor } from './redos-vulnerable-regex.js'
import { pythonFastapiFileUploadBodyVisitor } from './fastapi-file-upload-body.js'
import { pythonSnmpInsecureVersionVisitor } from './snmp-insecure-version.js'
import { pythonS3InsecureHttpVisitor } from './s3-insecure-http.js'
import { pythonS3UnrestrictedAccessVisitor } from './s3-unrestricted-access.js'
import { pythonLongTermAwsKeysInCodeVisitor } from './long-term-aws-keys-in-code.js'
import { pythonWildcardInOsCommandVisitor } from './wildcard-in-os-command.js'
import { pythonAwsIamOverlyBroadPolicyVisitor, pythonAwsIamAllPrivilegesVisitor } from './aws-iam-overly-broad-policy.js'
import { pythonAwsIamAllResourcesVisitor } from './aws-iam-all-resources.js'
import { pythonAwsUnrestrictedAdminAccessVisitor } from './aws-unrestricted-admin-access.js'
import { pythonAwsPublicPolicyVisitor, pythonAwsPublicResourceVisitor } from './aws-public-policy.js'
import { pythonAwsUnrestrictedOutboundVisitor } from './aws-unrestricted-outbound.js'
import { pythonAwsUnencryptedEbsVisitor } from './aws-unencrypted-ebs.js'
import { pythonAwsUnencryptedRdsVisitor } from './aws-unencrypted-rds.js'
import { pythonAwsUnencryptedOpenSearchVisitor } from './aws-unencrypted-opensearch.js'
import { pythonAwsUnencryptedSageMakerVisitor } from './aws-unencrypted-sagemaker.js'
import { pythonAwsUnencryptedSnsVisitor } from './aws-unencrypted-sns.js'
import { pythonAwsUnencryptedSqsVisitor } from './aws-unencrypted-sqs.js'
import { pythonAwsUnencryptedEfsVisitor } from './aws-unencrypted-efs.js'
import { pythonAwsPublicApiVisitor } from './aws-public-api.js'
import { pythonAwsS3NoVersioningVisitor } from './aws-s3-no-versioning.js'
import { pythonSubprocessWithoutShellVisitor } from './subprocess-without-shell.js'
import { pythonProcessWithPartialPathVisitor } from './process-with-partial-path.js'
import { pythonSslNoVersionVisitor } from './ssl-no-version.js'

export const SECURITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonSqlInjectionVisitor,
  pythonEvalUsageVisitor,
  pythonOsCommandInjectionVisitor,
  pythonWeakHashingVisitor,
  pythonUnverifiedCertificateVisitor,
  pythonInsecureCookieVisitor,
  pythonCookieWithoutHttpOnlyVisitor,
  pythonDisabledAutoEscapingVisitor,
  pythonWeakCipherVisitor,
  pythonWeakCryptoKeyVisitor,
  pythonWeakSslVisitor,
  pythonInsecureJwtVisitor,
  pythonEncryptionInsecureModeVisitor,
  pythonUnverifiedHostnameVisitor,
  pythonXmlXxeVisitor,
  pythonUnsafeUnzipVisitor,
  pythonFilePermissionsWorldAccessibleVisitor,
  pythonConfidentialInfoLoggingVisitor,
  pythonProductionDebugEnabledVisitor,
  pythonInsecureRandomVisitor,
  pythonSubprocessSecurityVisitor,
  pythonPartialPathExecutionVisitor,
  pythonSslVersionUnsafeVisitor,
  pythonVulnerableLibraryImportVisitor,
  pythonProcessStartNoShellVisitor,
  pythonNonOctalFilePermissionsVisitor,
  pythonUnsafeYamlLoadVisitor,
  pythonUnsafePickleUsageVisitor,
  pythonSshNoHostKeyVerificationVisitor,
  pythonUnsafeTempFileVisitor,
  pythonFlaskSecretKeyDisclosedVisitor,
  pythonDjangoRawSqlVisitor,
  pythonUnsafeMarkupVisitor,
  pythonLoggingConfigInsecureListenVisitor,
  pythonUnsafeTorchLoadVisitor,
  pythonParamikoCallVisitor,
  pythonSuspiciousUrlOpenVisitor,
  pythonRedosVulnerableRegexVisitor,
  pythonFastapiFileUploadBodyVisitor,
  pythonSnmpInsecureVersionVisitor,
  pythonS3InsecureHttpVisitor,
  pythonS3UnrestrictedAccessVisitor,
  pythonLongTermAwsKeysInCodeVisitor,
  pythonWildcardInOsCommandVisitor,
  // AWS CDK / cloud-infrastructure
  pythonAwsIamOverlyBroadPolicyVisitor,
  pythonAwsIamAllPrivilegesVisitor,
  pythonAwsIamAllResourcesVisitor,
  pythonAwsUnrestrictedAdminAccessVisitor,
  pythonAwsPublicPolicyVisitor,
  pythonAwsPublicResourceVisitor,
  pythonAwsUnrestrictedOutboundVisitor,
  pythonAwsUnencryptedEbsVisitor,
  pythonAwsUnencryptedRdsVisitor,
  pythonAwsUnencryptedOpenSearchVisitor,
  pythonAwsUnencryptedSageMakerVisitor,
  pythonAwsUnencryptedSnsVisitor,
  pythonAwsUnencryptedSqsVisitor,
  pythonAwsUnencryptedEfsVisitor,
  pythonAwsPublicApiVisitor,
  pythonAwsS3NoVersioningVisitor,
  // Subprocess / SSL
  pythonSubprocessWithoutShellVisitor,
  pythonProcessWithPartialPathVisitor,
  pythonSslNoVersionVisitor,
]
