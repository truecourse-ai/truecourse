// Paraphrased positive fixture for bugs/deterministic/duplicate-class-members.
//
// A static member and an instance member sharing a name live in different
// namespaces — `static fieldNames` is a property of the class object, while
// `get fieldNames()` is on the prototype. Neither shadows the other.

export class GeneratedTable {
  public static readonly fieldNames: string[] = ['a', 'b', 'c'];

  public get fieldNames(): string[] {
    return GeneratedTable.fieldNames;
  }
}
