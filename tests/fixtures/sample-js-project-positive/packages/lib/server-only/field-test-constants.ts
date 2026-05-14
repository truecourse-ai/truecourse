
// Field test data object with type and overflow discriminants — typed test fixture constant
type FieldTestEntry = {
  type: string;
  overflow: string;
  page: number;
  positionX: number;
  positionY: number;
};

const DATE_FIELD_OVERFLOW_TESTS: FieldTestEntry[] = [
  { type: 'date', overflow: 'auto', page: 1, positionX: 10, positionY: 20 },
  { type: 'date', overflow: 'clip', page: 1, positionX: 10, positionY: 40 },
  { type: 'date', overflow: 'scroll', page: 1, positionX: 10, positionY: 60 },
];
