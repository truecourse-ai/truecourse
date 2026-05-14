declare const isThrottled: boolean;
declare const isSubmitting: boolean;
declare function throttledOnCompleteClick(): void;

const CompletionButton = () => {
  return (
    <button
      disabled={isThrottled}
      onClick={() => throttledOnCompleteClick()}
    >
      Complete
    </button>
  );
};
