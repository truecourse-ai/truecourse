
// Positive sample: unchecked-array-access fires on the existing FRIENDLY_STATUS_MAP[status] at line 64.
// status is typed ExtendedDocumentStatus; FRIENDLY_STATUS_MAP is a Record keyed by that type —
// the rule fires on the subscript_expression without a key-existence check.

