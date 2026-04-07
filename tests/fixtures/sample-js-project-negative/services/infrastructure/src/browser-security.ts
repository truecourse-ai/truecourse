/**
 * Browser security patterns — cross-origin, permissions, DOM sanitization.
 */

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function listenForMessages() {
  // VIOLATION: security/deterministic/unverified-cross-origin-message
  window.addEventListener('message', (event) => {
    const data = event.data;
    document.getElementById('output')!.textContent = data;
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function requestCameraAccess() {
  // VIOLATION: security/deterministic/intrusive-permissions
  navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function requestGeolocation() {
  // VIOLATION: security/deterministic/intrusive-permissions
  navigator.geolocation.getCurrentPosition((pos) => {
    // VIOLATION: code-quality/deterministic/console-log
    console.log(pos.coords);
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function queryCameraPermission() {
  // VIOLATION: security/deterministic/intrusive-permissions
  navigator.permissions.query({ name: 'camera' });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function angularBypass() {
  const sanitizer = { bypassSecurityTrustHtml: (html: string) => html };
  // VIOLATION: security/deterministic/angular-sanitization-bypass
  return sanitizer.bypassSecurityTrustHtml('<script>alert("xss")</script>');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function unsafePurifyConfig(dirty: string) {
  const DOMPurify = { sanitize: (input: string, opts?: any) => input };
  // VIOLATION: security/deterministic/dompurify-unsafe-config
  return DOMPurify.sanitize(dirty, { ALLOW_UNKNOWN_PROTOCOLS: true });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function renderDynamicTemplate(req: any) {
  const engine = { render: (template: string, data: any) => template };
  // VIOLATION: security/deterministic/dynamically-constructed-template
  return engine.render(`<h1>Hello ${req.query.name}</h1>`, {});
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function disableResourceIntegrity() {
  // NOTE: disabled-resource-integrity requires TSX (JSX elements), see ReactBugs.tsx
  return { integrity: false, crossorigin: 'anonymous' };
}
