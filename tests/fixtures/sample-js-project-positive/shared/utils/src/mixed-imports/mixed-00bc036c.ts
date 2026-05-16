import { helper_00bc036c, type Foo_00bc036c, type Bar_00bc036c } from './module-00bc036c';
export function use_00bc036c(f: Foo_00bc036c, b: Bar_00bc036c): unknown { return helper_00bc036c(f, b); }


// FP shape: TS 4.5+ inline `type` keyword in a combined import — valid and idiomatic.
// Bundlers strip type-only specifiers at build time. Not a true mixed-import problem.
import { buildFormSchema, type FormSchemaInput } from './module-00bc036c';

export function validateFormInput(input: FormSchemaInput): boolean {
  const schema = buildFormSchema();
  return schema.safeParse(input).success;
}

