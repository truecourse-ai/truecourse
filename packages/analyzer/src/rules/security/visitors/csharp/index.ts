import type { CodeRuleVisitor } from '../../../types.js'

export { csharpSqlInjectionVisitor } from './sql-injection.js'
export { csharpHardcodedSqlExpressionVisitor } from './hardcoded-sql-expression.js'
export { csharpEvalUsageVisitor } from './eval-usage.js'
export { csharpOsCommandInjectionVisitor } from './os-command-injection.js'
export { csharpWildcardInOsCommandVisitor } from './wildcard-in-os-command.js'
export { csharpWeakHashingVisitor } from './weak-hashing.js'
export { csharpWeakCipherVisitor } from './weak-cipher.js'
export { csharpWeakCryptoKeyVisitor } from './weak-crypto-key.js'
export { csharpEncryptionInsecureModeVisitor } from './encryption-insecure-mode.js'
export { csharpWeakSslVisitor } from './weak-ssl.js'
export { csharpUnverifiedCertificateVisitor } from './unverified-certificate.js'
export { csharpPermissiveCorsVisitor } from './permissive-cors.js'
export { csharpInsecureCookieVisitor, csharpCookieWithoutHttpOnlyVisitor } from './insecure-cookie.js'
export { csharpCsrfDisabledVisitor } from './csrf-disabled.js'
export { csharpXmlXxeVisitor } from './xml-xxe.js'
export { csharpUnsafePickleUsageVisitor } from './unsafe-pickle-usage.js'
export { csharpInsecureJwtVisitor } from './insecure-jwt.js'
export { csharpJwtNoExpiryVisitor } from './jwt-no-expiry.js'
export { csharpJwtSecretKeyDisclosedVisitor } from './jwt-secret-key-disclosed.js'
export { csharpTimingAttackComparisonVisitor } from './timing-attack-comparison.js'
export { csharpInsecureRandomVisitor } from './insecure-random.js'
export { csharpProductionDebugEnabledVisitor } from './production-debug-enabled.js'
export { csharpConfidentialInfoLoggingVisitor } from './confidential-info-logging.js'
export { csharpSensitiveDataInUrlVisitor } from './sensitive-data-in-url.js'
export { csharpUserInputInRedirectVisitor } from './user-input-in-redirect.js'
export { csharpUserInputInPathVisitor } from './user-input-in-path.js'
export { csharpUnsafeUnzipVisitor } from './unsafe-unzip.js'
export { csharpMixedHttpMethodsVisitor } from './mixed-http-methods.js'
export { csharpBindAllInterfacesVisitor } from './bind-all-interfaces.js'
export { csharpUnsafeXmlSignatureVisitor } from './unsafe-xml-signature.js'
export { csharpSshNoHostKeyVerificationVisitor } from './ssh-no-host-key-verification.js'
export { csharpUnrestrictedFileUploadVisitor } from './unrestricted-file-upload.js'
export { csharpFilePermissionsWorldAccessibleVisitor } from './file-permissions-world-accessible.js'
export { csharpSnmpInsecureVersionVisitor } from './snmp-insecure-version.js'
export { csharpSnmpWeakCryptoVisitor } from './snmp-weak-crypto.js'
export { csharpRedosVulnerableRegexVisitor } from './redos-vulnerable-regex.js'
export { csharpIpForwardingVisitor } from './ip-forwarding.js'
export { csharpHardcodedPasswordFunctionArgVisitor } from './hardcoded-password-function-arg.js'
export { csharpPubliclyWritableDirectoryVisitor } from './publicly-writable-directory.js'
export { csharpLongTermAwsKeysInCodeVisitor } from './long-term-aws-keys-in-code.js'
export { csharpS3InsecureHttpVisitor } from './s3-insecure-http.js'

import { csharpSqlInjectionVisitor } from './sql-injection.js'
import { csharpHardcodedSqlExpressionVisitor } from './hardcoded-sql-expression.js'
import { csharpEvalUsageVisitor } from './eval-usage.js'
import { csharpOsCommandInjectionVisitor } from './os-command-injection.js'
import { csharpWildcardInOsCommandVisitor } from './wildcard-in-os-command.js'
import { csharpWeakHashingVisitor } from './weak-hashing.js'
import { csharpWeakCipherVisitor } from './weak-cipher.js'
import { csharpWeakCryptoKeyVisitor } from './weak-crypto-key.js'
import { csharpEncryptionInsecureModeVisitor } from './encryption-insecure-mode.js'
import { csharpWeakSslVisitor } from './weak-ssl.js'
import { csharpUnverifiedCertificateVisitor } from './unverified-certificate.js'
import { csharpPermissiveCorsVisitor } from './permissive-cors.js'
import { csharpInsecureCookieVisitor, csharpCookieWithoutHttpOnlyVisitor } from './insecure-cookie.js'
import { csharpCsrfDisabledVisitor } from './csrf-disabled.js'
import { csharpXmlXxeVisitor } from './xml-xxe.js'
import { csharpUnsafePickleUsageVisitor } from './unsafe-pickle-usage.js'
import { csharpInsecureJwtVisitor } from './insecure-jwt.js'
import { csharpJwtNoExpiryVisitor } from './jwt-no-expiry.js'
import { csharpJwtSecretKeyDisclosedVisitor } from './jwt-secret-key-disclosed.js'
import { csharpTimingAttackComparisonVisitor } from './timing-attack-comparison.js'
import { csharpInsecureRandomVisitor } from './insecure-random.js'
import { csharpProductionDebugEnabledVisitor } from './production-debug-enabled.js'
import { csharpConfidentialInfoLoggingVisitor } from './confidential-info-logging.js'
import { csharpSensitiveDataInUrlVisitor } from './sensitive-data-in-url.js'
import { csharpUserInputInRedirectVisitor } from './user-input-in-redirect.js'
import { csharpUserInputInPathVisitor } from './user-input-in-path.js'
import { csharpUnsafeUnzipVisitor } from './unsafe-unzip.js'
import { csharpMixedHttpMethodsVisitor } from './mixed-http-methods.js'
import { csharpBindAllInterfacesVisitor } from './bind-all-interfaces.js'
import { csharpUnsafeXmlSignatureVisitor } from './unsafe-xml-signature.js'
import { csharpSshNoHostKeyVerificationVisitor } from './ssh-no-host-key-verification.js'
import { csharpUnrestrictedFileUploadVisitor } from './unrestricted-file-upload.js'
import { csharpFilePermissionsWorldAccessibleVisitor } from './file-permissions-world-accessible.js'
import { csharpSnmpInsecureVersionVisitor } from './snmp-insecure-version.js'
import { csharpSnmpWeakCryptoVisitor } from './snmp-weak-crypto.js'
import { csharpRedosVulnerableRegexVisitor } from './redos-vulnerable-regex.js'
import { csharpIpForwardingVisitor } from './ip-forwarding.js'
import { csharpHardcodedPasswordFunctionArgVisitor } from './hardcoded-password-function-arg.js'
import { csharpPubliclyWritableDirectoryVisitor } from './publicly-writable-directory.js'
import { csharpLongTermAwsKeysInCodeVisitor } from './long-term-aws-keys-in-code.js'
import { csharpS3InsecureHttpVisitor } from './s3-insecure-http.js'

export const SECURITY_CSHARP_VISITORS: CodeRuleVisitor[] = [
  // Injection
  csharpSqlInjectionVisitor,
  csharpHardcodedSqlExpressionVisitor,
  csharpEvalUsageVisitor,
  csharpOsCommandInjectionVisitor,
  csharpWildcardInOsCommandVisitor,
  // Cryptography
  csharpWeakHashingVisitor,
  csharpWeakCipherVisitor,
  csharpWeakCryptoKeyVisitor,
  csharpEncryptionInsecureModeVisitor,
  csharpWeakSslVisitor,
  csharpUnverifiedCertificateVisitor,
  csharpInsecureRandomVisitor,
  // Web / ASP.NET
  csharpPermissiveCorsVisitor,
  csharpInsecureCookieVisitor,
  csharpCookieWithoutHttpOnlyVisitor,
  csharpCsrfDisabledVisitor,
  csharpProductionDebugEnabledVisitor,
  csharpUserInputInRedirectVisitor,
  csharpUserInputInPathVisitor,
  csharpMixedHttpMethodsVisitor,
  csharpUnrestrictedFileUploadVisitor,
  csharpIpForwardingVisitor,
  csharpBindAllInterfacesVisitor,
  // JWT / secrets
  csharpInsecureJwtVisitor,
  csharpJwtNoExpiryVisitor,
  csharpJwtSecretKeyDisclosedVisitor,
  csharpHardcodedPasswordFunctionArgVisitor,
  csharpLongTermAwsKeysInCodeVisitor,
  csharpSensitiveDataInUrlVisitor,
  csharpConfidentialInfoLoggingVisitor,
  csharpTimingAttackComparisonVisitor,
  // Parsing / deserialization
  csharpXmlXxeVisitor,
  csharpUnsafePickleUsageVisitor,
  csharpUnsafeXmlSignatureVisitor,
  csharpUnsafeUnzipVisitor,
  csharpRedosVulnerableRegexVisitor,
  // Files / processes / network
  csharpFilePermissionsWorldAccessibleVisitor,
  csharpPubliclyWritableDirectoryVisitor,
  csharpSshNoHostKeyVerificationVisitor,
  csharpSnmpInsecureVersionVisitor,
  csharpSnmpWeakCryptoVisitor,
  csharpS3InsecureHttpVisitor,
]
