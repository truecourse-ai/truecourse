/**
 * Security violations related to user input handling and file operations.
 */

import fs from 'fs';
import path from 'path';

// VIOLATION: security/deterministic/angular-sanitization-bypass
export function angularSanitizationBypass() {
  const sanitizer = { bypassSecurityTrustHtml: (html: string) => html };
  return sanitizer.bypassSecurityTrustHtml('<script>alert("xss")</script>');
}

// VIOLATION: security/deterministic/disabled-auto-escaping
export function disabledAutoEscaping(userInput: string) {
  const element = document.getElementById('output')!;
  element.innerHTML = userInput;
}

// VIOLATION: security/deterministic/dompurify-unsafe-config
export function dompurifyUnsafeConfig(dirty: string) {
  const DOMPurify = { sanitize: (input: string, opts?: any) => input };
  return DOMPurify.sanitize(dirty, { ALLOW_UNKNOWN_PROTOCOLS: true });
}

// VIOLATION: security/deterministic/dynamically-constructed-template
export function dynamicallyConstructedTemplate(req: any) {
  const engine = { render: (template: string, data: any) => template };
  return engine.render(`<h1>Hello ${req.query.name}</h1>`, {});
}

// VIOLATION: security/deterministic/file-permissions-world-accessible
export function filePermissionsWorldAccessible() {
  fs.chmodSync('/tmp/data.txt', 0o777);
}

// VIOLATION: security/deterministic/mass-assignment
export function massAssignment(req: any) {
  const User = { create: (data: any) => data };
  return User.create(req.body);
}

// VIOLATION: security/deterministic/path-command-injection
export function pathCommandInjection(req: any) {
  const filePath = path.join('/uploads', req.params.filename);
  return filePath;
}

// VIOLATION: security/deterministic/publicly-writable-directory
export function publiclyWritableDirectory() {
  fs.writeFileSync('/tmp/cache/data.json', '{}');
}

// VIOLATION: security/deterministic/unrestricted-file-upload
export function unrestrictedFileUpload() {
  const multer = (opts: any) => opts;
  return multer({ dest: 'uploads/' });
}

// VIOLATION: security/deterministic/user-input-in-path
export function userInputInPath(req: any) {
  const data = fs.readFileSync(req.params.filePath, 'utf8');
  return data;
}

// VIOLATION: security/deterministic/user-input-in-redirect
export function userInputInRedirect(req: any, res: any) {
  res.redirect(req.query.returnUrl);
}
