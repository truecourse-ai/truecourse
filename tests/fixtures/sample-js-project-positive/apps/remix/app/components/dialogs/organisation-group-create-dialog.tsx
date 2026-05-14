
// Positive sample: unchecked-array-access fires on the existing EXTENDED_ORGANISATION_MEMBER_ROLE_MAP[role] at line 164.
// role comes from iterating ORGANISATION_MEMBER_ROLE_HIERARCHY[...] — the subscript_expression
// uses a variable index without a key-existence or bounds check.

