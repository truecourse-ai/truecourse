export const Status = {
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC',
  ORGANISATION: 'ORGANISATION',
} as const;

export type Status = (typeof Status)[keyof typeof Status];
