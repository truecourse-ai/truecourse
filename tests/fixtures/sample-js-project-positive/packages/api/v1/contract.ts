// URL inside a deprecation description string — pure documentation text, no runtime behavior.
const DEPRECATED_ENDPOINT = {
  path: '/v1/documents',
  description: 'Deprecated: use /v2/documents instead. See https://docs.example.com/migration/v2 for migration guide.',
};


// URL inside a deprecation description string — pure documentation text, no runtime behavior
const DEPRECATED_V1_RECIPIENTS = {
  path: '/v1/envelopes/:id/recipients',
  description: 'Deprecated: use /v2/envelopes/:id/recipients instead. See https://docs.example.com/api/migration for details.',
};



// hardcoded-url: URL in deprecation notice string — runtime string, not a JSX attribute
const DEPRECATED_V1_RECIPIENTS_NOTICE = 'Deprecated: use /v2/recipients instead. See https://docs.truecourse.io/api/migration for migration guide.';

