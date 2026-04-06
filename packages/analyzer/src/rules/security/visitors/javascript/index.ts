import type { CodeRuleVisitor } from '../../../types.js'

export { sqlInjectionVisitor } from './sql-injection.js'
export { evalUsageVisitor } from './eval-usage.js'
export { osCommandInjectionVisitor } from './os-command-injection.js'
export { weakHashingVisitor } from './weak-hashing.js'
export { unverifiedCertificateVisitor } from './unverified-certificate.js'
export { permissiveCorsVisitor } from './permissive-cors.js'
export { insecureCookieVisitor, cookieWithoutHttpOnlyVisitor } from './insecure-cookie.js'
export { disabledAutoEscapingVisitor } from './disabled-auto-escaping.js'
export { csrfDisabledVisitor } from './csrf-disabled.js'
export { weakCipherVisitor } from './weak-cipher.js'
export { weakCryptoKeyVisitor } from './weak-crypto-key.js'
export { weakSslVisitor } from './weak-ssl.js'
export { insecureJwtVisitor } from './insecure-jwt.js'
export { encryptionInsecureModeVisitor } from './encryption-insecure-mode.js'
export { missingContentSecurityPolicyVisitor } from './missing-content-security-policy.js'
export { missingFrameAncestorsVisitor } from './missing-frame-ancestors.js'
export { missingStrictTransportVisitor } from './missing-strict-transport.js'
export { missingReferrerPolicyVisitor } from './missing-referrer-policy.js'
export { missingMimeSniffProtectionVisitor } from './missing-mime-sniff-protection.js'
export { serverFingerprintingVisitor } from './server-fingerprinting.js'
export { unverifiedHostnameVisitor } from './unverified-hostname.js'
export { xmlXxeVisitor } from './xml-xxe.js'
export { unsafeUnzipVisitor } from './unsafe-unzip.js'
export { filePermissionsWorldAccessibleVisitor } from './file-permissions-world-accessible.js'
export { unrestrictedFileUploadVisitor } from './unrestricted-file-upload.js'
export { hiddenFileExposureVisitor } from './hidden-file-exposure.js'
export { linkTargetBlankVisitor } from './link-target-blank.js'
export { confidentialInfoLoggingVisitor } from './confidential-info-logging.js'
export { productionDebugEnabledVisitor } from './production-debug-enabled.js'
export { insecureRandomVisitor } from './insecure-random.js'
export { ipForwardingVisitor } from './ip-forwarding.js'
export { dompurifyUnsafeConfigVisitor } from './dompurify-unsafe-config.js'
export { disabledResourceIntegrityVisitor } from './disabled-resource-integrity.js'
export { pathCommandInjectionVisitor } from './path-command-injection.js'
export { mixedContentVisitor } from './mixed-content.js'
export { sslVersionUnsafeVisitor } from './ssl-version-unsafe.js'
export { unverifiedCrossOriginMessageVisitor } from './unverified-cross-origin-message.js'
export { intrusivePermissionsVisitor } from './intrusive-permissions.js'
export { sessionNotRegeneratedVisitor } from './session-not-regenerated.js'
export { publiclyWritableDirectoryVisitor } from './publicly-writable-directory.js'
export { dynamicallyConstructedTemplateVisitor } from './dynamically-constructed-template.js'
export { angularSanitizationBypassVisitor } from './angular-sanitization-bypass.js'
export { sessionCookieOnStaticVisitor } from './session-cookie-on-static.js'
export { userIdFromRequestBodyVisitor } from './user-id-from-request-body.js'
export { massAssignmentVisitor } from './mass-assignment.js'
export { timingAttackComparisonVisitor } from './timing-attack-comparison.js'
export { userInputInPathVisitor } from './user-input-in-path.js'
export { userInputInRedirectVisitor } from './user-input-in-redirect.js'
export { missingHelmetMiddlewareVisitor } from './missing-helmet-middleware.js'
export { jwtNoExpiryVisitor } from './jwt-no-expiry.js'
export { sensitiveDataInUrlVisitor } from './sensitive-data-in-url.js'
export { expressTrustProxyNotSetVisitor } from './express-trust-proxy-not-set.js'
export { hardcodedPasswordFunctionArgVisitor } from './hardcoded-password-function-arg.js'
export { jwtSecretKeyDisclosedVisitor } from './jwt-secret-key-disclosed.js'
export { bindAllInterfacesVisitor } from './bind-all-interfaces.js'
export { nonStandardCryptoVisitor } from './non-standard-crypto.js'
export { graphqlDosVulnerabilityVisitor } from './graphql-dos-vulnerability.js'
export { graphqlIntrospectionEnabledVisitor } from './graphql-introspection-enabled.js'
export { unsafeXmlSignatureVisitor } from './unsafe-xml-signature.js'
export { mixedHttpMethodsVisitor } from './mixed-http-methods.js'
export { processSignalingVisitor } from './process-signaling.js'
export { longTermAwsKeysInCodeVisitor } from './long-term-aws-keys-in-code.js'
export { snmpInsecureVersionVisitor } from './snmp-insecure-version.js'
export { snmpWeakCryptoVisitor } from './snmp-weak-crypto.js'
export { hardcodedSqlExpressionVisitor } from './hardcoded-sql-expression.js'
export { wildcardInOsCommandVisitor } from './wildcard-in-os-command.js'
export { s3MissingBucketOwnerVisitor } from './s3-missing-bucket-owner.js'
export { s3PublicBucketAccessVisitor } from './s3-public-bucket-access.js'
export { s3InsecureHttpVisitor } from './s3-insecure-http.js'
export { s3UnrestrictedAccessVisitor } from './s3-unrestricted-access.js'
export { awsPublicApiVisitor } from './aws-public-api.js'
export { awsPublicResourceVisitor } from './aws-public-resource.js'
export { awsUnencryptedEbsVisitor } from './aws-unencrypted-ebs.js'
export { awsUnencryptedEfsVisitor } from './aws-unencrypted-efs.js'
export { awsIamAllPrivilegesVisitor } from './aws-iam-all-privileges.js'
export { awsIamAllResourcesVisitor } from './aws-iam-all-resources.js'
export { awsIamPrivilegeEscalationVisitor } from './aws-iam-privilege-escalation.js'
export { awsIamPublicAccessVisitor } from './aws-iam-public-access.js'
export { awsUnencryptedOpenSearchVisitor } from './aws-unencrypted-opensearch.js'
export { awsUnencryptedRdsVisitor } from './aws-unencrypted-rds.js'
export { awsUnrestrictedAdminIpVisitor } from './aws-unrestricted-admin-ip.js'
export { awsS3BucketAccessVisitor } from './aws-s3-bucket-access.js'
export { awsS3InsecureHttpVisitor } from './aws-s3-insecure-http.js'
export { awsS3PublicAccessVisitor } from './aws-s3-public-access.js'
export { awsS3NoVersioningVisitor } from './aws-s3-no-versioning.js'
export { awsUnencryptedSageMakerVisitor } from './aws-unencrypted-sagemaker.js'
export { awsUnencryptedSnsVisitor } from './aws-unencrypted-sns.js'
export { awsUnencryptedSqsVisitor } from './aws-unencrypted-sqs.js'

import { sqlInjectionVisitor } from './sql-injection.js'
import { evalUsageVisitor } from './eval-usage.js'
import { osCommandInjectionVisitor } from './os-command-injection.js'
import { weakHashingVisitor } from './weak-hashing.js'
import { unverifiedCertificateVisitor } from './unverified-certificate.js'
import { permissiveCorsVisitor } from './permissive-cors.js'
import { insecureCookieVisitor, cookieWithoutHttpOnlyVisitor } from './insecure-cookie.js'
import { disabledAutoEscapingVisitor } from './disabled-auto-escaping.js'
import { csrfDisabledVisitor } from './csrf-disabled.js'
import { weakCipherVisitor } from './weak-cipher.js'
import { weakCryptoKeyVisitor } from './weak-crypto-key.js'
import { weakSslVisitor } from './weak-ssl.js'
import { insecureJwtVisitor } from './insecure-jwt.js'
import { encryptionInsecureModeVisitor } from './encryption-insecure-mode.js'
import { missingContentSecurityPolicyVisitor } from './missing-content-security-policy.js'
import { missingFrameAncestorsVisitor } from './missing-frame-ancestors.js'
import { missingStrictTransportVisitor } from './missing-strict-transport.js'
import { missingReferrerPolicyVisitor } from './missing-referrer-policy.js'
import { missingMimeSniffProtectionVisitor } from './missing-mime-sniff-protection.js'
import { serverFingerprintingVisitor } from './server-fingerprinting.js'
import { unverifiedHostnameVisitor } from './unverified-hostname.js'
import { xmlXxeVisitor } from './xml-xxe.js'
import { unsafeUnzipVisitor } from './unsafe-unzip.js'
import { filePermissionsWorldAccessibleVisitor } from './file-permissions-world-accessible.js'
import { unrestrictedFileUploadVisitor } from './unrestricted-file-upload.js'
import { hiddenFileExposureVisitor } from './hidden-file-exposure.js'
import { linkTargetBlankVisitor } from './link-target-blank.js'
import { confidentialInfoLoggingVisitor } from './confidential-info-logging.js'
import { productionDebugEnabledVisitor } from './production-debug-enabled.js'
import { insecureRandomVisitor } from './insecure-random.js'
import { ipForwardingVisitor } from './ip-forwarding.js'
import { dompurifyUnsafeConfigVisitor } from './dompurify-unsafe-config.js'
import { disabledResourceIntegrityVisitor } from './disabled-resource-integrity.js'
import { pathCommandInjectionVisitor } from './path-command-injection.js'
import { mixedContentVisitor } from './mixed-content.js'
import { sslVersionUnsafeVisitor } from './ssl-version-unsafe.js'
import { unverifiedCrossOriginMessageVisitor } from './unverified-cross-origin-message.js'
import { intrusivePermissionsVisitor } from './intrusive-permissions.js'
import { sessionNotRegeneratedVisitor } from './session-not-regenerated.js'
import { publiclyWritableDirectoryVisitor } from './publicly-writable-directory.js'
import { dynamicallyConstructedTemplateVisitor } from './dynamically-constructed-template.js'
import { angularSanitizationBypassVisitor } from './angular-sanitization-bypass.js'
import { sessionCookieOnStaticVisitor } from './session-cookie-on-static.js'
import { userIdFromRequestBodyVisitor } from './user-id-from-request-body.js'
import { massAssignmentVisitor } from './mass-assignment.js'
import { timingAttackComparisonVisitor } from './timing-attack-comparison.js'
import { userInputInPathVisitor } from './user-input-in-path.js'
import { userInputInRedirectVisitor } from './user-input-in-redirect.js'
import { missingHelmetMiddlewareVisitor } from './missing-helmet-middleware.js'
import { jwtNoExpiryVisitor } from './jwt-no-expiry.js'
import { sensitiveDataInUrlVisitor } from './sensitive-data-in-url.js'
import { expressTrustProxyNotSetVisitor } from './express-trust-proxy-not-set.js'
import { hardcodedPasswordFunctionArgVisitor } from './hardcoded-password-function-arg.js'
import { jwtSecretKeyDisclosedVisitor } from './jwt-secret-key-disclosed.js'
import { bindAllInterfacesVisitor } from './bind-all-interfaces.js'
import { nonStandardCryptoVisitor } from './non-standard-crypto.js'
import { graphqlDosVulnerabilityVisitor } from './graphql-dos-vulnerability.js'
import { graphqlIntrospectionEnabledVisitor } from './graphql-introspection-enabled.js'
import { unsafeXmlSignatureVisitor } from './unsafe-xml-signature.js'
import { mixedHttpMethodsVisitor } from './mixed-http-methods.js'
import { processSignalingVisitor } from './process-signaling.js'
import { longTermAwsKeysInCodeVisitor } from './long-term-aws-keys-in-code.js'
import { snmpInsecureVersionVisitor } from './snmp-insecure-version.js'
import { snmpWeakCryptoVisitor } from './snmp-weak-crypto.js'
import { hardcodedSqlExpressionVisitor } from './hardcoded-sql-expression.js'
import { wildcardInOsCommandVisitor } from './wildcard-in-os-command.js'
import { s3MissingBucketOwnerVisitor } from './s3-missing-bucket-owner.js'
import { s3PublicBucketAccessVisitor } from './s3-public-bucket-access.js'
import { s3InsecureHttpVisitor } from './s3-insecure-http.js'
import { s3UnrestrictedAccessVisitor } from './s3-unrestricted-access.js'
import { awsPublicApiVisitor } from './aws-public-api.js'
import { awsPublicResourceVisitor } from './aws-public-resource.js'
import { awsUnencryptedEbsVisitor } from './aws-unencrypted-ebs.js'
import { awsUnencryptedEfsVisitor } from './aws-unencrypted-efs.js'
import { awsIamAllPrivilegesVisitor } from './aws-iam-all-privileges.js'
import { awsIamAllResourcesVisitor } from './aws-iam-all-resources.js'
import { awsIamPrivilegeEscalationVisitor } from './aws-iam-privilege-escalation.js'
import { awsIamPublicAccessVisitor } from './aws-iam-public-access.js'
import { awsUnencryptedOpenSearchVisitor } from './aws-unencrypted-opensearch.js'
import { awsUnencryptedRdsVisitor } from './aws-unencrypted-rds.js'
import { awsUnrestrictedAdminIpVisitor } from './aws-unrestricted-admin-ip.js'
import { awsS3BucketAccessVisitor } from './aws-s3-bucket-access.js'
import { awsS3InsecureHttpVisitor } from './aws-s3-insecure-http.js'
import { awsS3PublicAccessVisitor } from './aws-s3-public-access.js'
import { awsS3NoVersioningVisitor } from './aws-s3-no-versioning.js'
import { awsUnencryptedSageMakerVisitor } from './aws-unencrypted-sagemaker.js'
import { awsUnencryptedSnsVisitor } from './aws-unencrypted-sns.js'
import { awsUnencryptedSqsVisitor } from './aws-unencrypted-sqs.js'

export const SECURITY_JS_VISITORS: CodeRuleVisitor[] = [
  sqlInjectionVisitor,
  evalUsageVisitor,
  osCommandInjectionVisitor,
  weakHashingVisitor,
  unverifiedCertificateVisitor,
  permissiveCorsVisitor,
  insecureCookieVisitor,
  cookieWithoutHttpOnlyVisitor,
  disabledAutoEscapingVisitor,
  csrfDisabledVisitor,
  weakCipherVisitor,
  weakCryptoKeyVisitor,
  weakSslVisitor,
  insecureJwtVisitor,
  encryptionInsecureModeVisitor,
  missingContentSecurityPolicyVisitor,
  missingFrameAncestorsVisitor,
  missingStrictTransportVisitor,
  missingReferrerPolicyVisitor,
  missingMimeSniffProtectionVisitor,
  serverFingerprintingVisitor,
  unverifiedHostnameVisitor,
  xmlXxeVisitor,
  unsafeUnzipVisitor,
  filePermissionsWorldAccessibleVisitor,
  unrestrictedFileUploadVisitor,
  hiddenFileExposureVisitor,
  linkTargetBlankVisitor,
  confidentialInfoLoggingVisitor,
  productionDebugEnabledVisitor,
  insecureRandomVisitor,
  ipForwardingVisitor,
  dompurifyUnsafeConfigVisitor,
  disabledResourceIntegrityVisitor,
  pathCommandInjectionVisitor,
  mixedContentVisitor,
  sslVersionUnsafeVisitor,
  unverifiedCrossOriginMessageVisitor,
  intrusivePermissionsVisitor,
  sessionNotRegeneratedVisitor,
  publiclyWritableDirectoryVisitor,
  dynamicallyConstructedTemplateVisitor,
  angularSanitizationBypassVisitor,
  sessionCookieOnStaticVisitor,
  userIdFromRequestBodyVisitor,
  massAssignmentVisitor,
  timingAttackComparisonVisitor,
  userInputInPathVisitor,
  userInputInRedirectVisitor,
  missingHelmetMiddlewareVisitor,
  jwtNoExpiryVisitor,
  sensitiveDataInUrlVisitor,
  expressTrustProxyNotSetVisitor,
  hardcodedPasswordFunctionArgVisitor,
  jwtSecretKeyDisclosedVisitor,
  bindAllInterfacesVisitor,
  nonStandardCryptoVisitor,
  graphqlDosVulnerabilityVisitor,
  graphqlIntrospectionEnabledVisitor,
  unsafeXmlSignatureVisitor,
  mixedHttpMethodsVisitor,
  processSignalingVisitor,
  longTermAwsKeysInCodeVisitor,
  snmpInsecureVersionVisitor,
  snmpWeakCryptoVisitor,
  hardcodedSqlExpressionVisitor,
  wildcardInOsCommandVisitor,
  s3MissingBucketOwnerVisitor,
  s3PublicBucketAccessVisitor,
  s3InsecureHttpVisitor,
  s3UnrestrictedAccessVisitor,
  // AWS CDK / cloud-infrastructure
  awsPublicApiVisitor,
  awsPublicResourceVisitor,
  awsUnencryptedEbsVisitor,
  awsUnencryptedEfsVisitor,
  awsIamAllPrivilegesVisitor,
  awsIamAllResourcesVisitor,
  awsIamPrivilegeEscalationVisitor,
  awsIamPublicAccessVisitor,
  awsUnencryptedOpenSearchVisitor,
  awsUnencryptedRdsVisitor,
  awsUnrestrictedAdminIpVisitor,
  awsS3BucketAccessVisitor,
  awsS3InsecureHttpVisitor,
  awsS3PublicAccessVisitor,
  awsS3NoVersioningVisitor,
  awsUnencryptedSageMakerVisitor,
  awsUnencryptedSnsVisitor,
  awsUnencryptedSqsVisitor,
]
