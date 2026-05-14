// Test fixture array with repeated config values — intentional for multiple test cases
interface FieldTestMeta {
  type: string;
  required: boolean;
  defaultValue: string;
}

const fieldTestConfigs: FieldTestMeta[] = [
  { type: 'text', required: true, defaultValue: '' },
  { type: 'text', required: false, defaultValue: '' },
  { type: 'text', required: true, defaultValue: 'N/A' },
  { type: 'text', required: false, defaultValue: 'N/A' },
];
