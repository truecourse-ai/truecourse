// Paraphrased FP shapes for performance/deterministic/unnecessary-context-provider.

import { createContext } from 'react';

type StepValue = { current: number; total: number };
const StepCtx = createContext<StepValue>({ current: 0, total: 0 });

// 1. Provider wrapping a single `{expression}` JSX expression. The expression
//    can resolve to arbitrary JSX whose entire subtree (any depth) may consume
//    the context. The current "single child" heuristic must not flag this.
export function StepFrame({ value, child }: { value: StepValue; child: JSX.Element }): JSX.Element {
  return <StepCtx.Provider value={value}>{child}</StepCtx.Provider>;
}

type FormItemValue = { id: string };
const FormItemCtx = createContext<FormItemValue>({ id: '' });

// 2. Provider wrapping a single lowercase host element that forwards `{...rest}`
//    via spread. Children passed through `rest` reach descendants of the host
//    element, so context consumers can live anywhere in that subtree.
type ContainerProps = { itemValue: FormItemValue } & React.HTMLAttributes<HTMLDivElement>;
export function FormItemWrapper({ itemValue, ...rest }: ContainerProps): JSX.Element {
  return (
    <FormItemCtx.Provider value={itemValue}>
      <div className="form-item" {...rest} />
    </FormItemCtx.Provider>
  );
}
