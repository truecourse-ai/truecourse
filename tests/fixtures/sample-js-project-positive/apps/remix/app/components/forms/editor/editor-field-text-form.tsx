
// FP shape: useForm hook call with config object argument including nested defaultValues
declare function useForm<T>(config: {
  resolver?: unknown;
  mode?: 'onChange' | 'onBlur' | 'onSubmit';
  defaultValues?: Partial<T>;
}): { control: unknown };
declare function zodResolver(schema: unknown): unknown;
declare const ZTextFieldSchema: unknown;

type TTextFieldSchema = {
  label: string;
  fontSize: number;
  required: boolean;
  readOnly: boolean;
  placeholder: string;
};

const DEFAULT_FONT_SIZE = 14;

const EditorFieldTextForm = ({ value }: { value?: Partial<TTextFieldSchema> }) => {
  const form = useForm<TTextFieldSchema>({
    resolver: zodResolver(ZTextFieldSchema),
    mode: 'onChange',
    defaultValues: {
      label: value?.label || '',
      fontSize: value?.fontSize || DEFAULT_FONT_SIZE,
      required: value?.required || false,
      readOnly: value?.readOnly || false,
      placeholder: value?.placeholder || '',
    },
  });

  return null;
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
