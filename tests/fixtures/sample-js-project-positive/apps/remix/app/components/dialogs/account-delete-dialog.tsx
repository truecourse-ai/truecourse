

// Positive sample: inconsistent-return fires on the existing onDeleteAccount arrow function.
// It returns await authClient.signOut() in the try block but has an implicit undefined
// return when the catch block falls through — no explicit return type annotation.
// Additional function with same mixed-return shape:
function handleFormReset(form: { reset: () => void }, shouldClear: boolean) {
  if (!shouldClear) {
    return;
  }
  return form.reset();
}

