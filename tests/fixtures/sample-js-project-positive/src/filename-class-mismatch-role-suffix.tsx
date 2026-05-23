/**
 * Positive fixture for code-quality/deterministic/filename-class-mismatch.
 *
 * A common convention across email-template, React-component, and
 * service codebases: the file describes the *topic* in kebab-case, and
 * the exported symbol is `<TopicInPascalCase><RoleSuffix>` (e.g.
 * `Email`, `Component`, `Service`). The rule previously normalised both
 * names and compared them for equality, flagging every suffixed export
 * as a mismatch. Once the suffix tail is recognised as a conventional
 * role marker, the comparison should accept it.
 */

import * as React from 'react';

export function FilenameClassMismatchRoleSuffixComponent(): React.ReactElement {
  return <div>topic + role suffix</div>;
}

export default FilenameClassMismatchRoleSuffixComponent;
