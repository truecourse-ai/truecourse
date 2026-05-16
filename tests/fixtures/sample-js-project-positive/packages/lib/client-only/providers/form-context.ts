
// FP: {} as FormFieldContextValue is the standard React context initialization placeholder.
// Every consumer is inside a Provider that supplies the real value; the default is never consumed.
declare const React: {
  createContext: <T>(defaultValue: T) => { Provider: unknown; Consumer: unknown };
};

type FormFieldContextValue = {
  id: string;
  name: string;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);



// FP: {} as FormContextValue — standard React context initialization pattern.
// The default is a placeholder; every consumer is wrapped in a Provider.
declare const React2: {
  createContext: <T>(defaultValue: T) => { Provider: unknown };
};

type FormContextValue = {
  formId: string;
  isSubmitting: boolean;
  errors: Record<string, string>;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const FormContext = React2.createContext<FormContextValue>({} as FormContextValue);
