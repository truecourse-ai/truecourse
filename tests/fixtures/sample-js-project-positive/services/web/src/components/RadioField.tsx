import { useState } from 'react';

/**
 * `setX(x)` where `x` is a callback parameter or a fresh local computation
 * is the standard React pattern — the param shadows the state name and
 * the call passes the new value into state. The react-useless-set-state
 * rule should NOT fire on these shapes.
 *
 * Mirrors:
 *   documenso `apps/remix/app/components/general/document-signing/document-signing-radio-field.tsx:140`
 *     — `const handleSelectItem = (selectedOption) => setSelectedOption(selectedOption)`
 *   OpenHands `frontend/src/contexts/conversation-websocket-context.tsx:863,875`
 *     — `const errorMessage = error.message; setErrorMessage(errorMessage)`
 */

export function RadioField(): JSX.Element {
  const [selectedOption, setSelectedOption] = useState<string>('a');

  // Param `selectedOption` shadows the state — the call passes the
  // fresh value, not the unchanged state.
  const handleSelectItem = (selectedOption: string): void => {
    setSelectedOption(selectedOption);
  };

  return <button onClick={() => handleSelectItem('b')}>{selectedOption}</button>;
}

interface ErrorReporter {
  readonly send: () => Promise<void>;
}

export function ErrorBanner({ reporter }: { readonly reporter: ErrorReporter }): JSX.Element {
  const [bannerText, setBannerText] = useState<string>('');

  // `errorMessage` here is a fresh local computed inside the catch
  // block, not the `bannerText` state. The handler should setBannerText
  // to the computed value.
  const fire = async (): Promise<void> => {
    try {
      await reporter.send();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed';
      setBannerText(errorMessage);
    }
  };

  return <div onClick={() => void fire()}>{bannerText}</div>;
}

// Local variable that happens to match the state name — the call
// passes the fresh computed value, not the state itself.
export function ToggleCard({ initial }: { readonly initial: boolean }): JSX.Element {
  const [open, setOpen] = useState<boolean>(initial);

  const expand = (): void => {
    const computedOpen = !initial;
    setOpen(computedOpen);
  };

  return <button onClick={expand}>{open ? 'open' : 'closed'}</button>;
}
