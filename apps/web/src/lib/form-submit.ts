import { type FormEvent, startTransition } from "react";

// onSubmit for a settings form that keeps showing what was saved.
//
// After a form's `action` runs, React resets the form to the values its fields
// had when they were first rendered, not to the new props: a select and a
// controlled checkbox or radio show the old setting until the page is
// reloaded. Submitting from onSubmit skips that reset. Keep `action` on the
// form too, so it still posts without JavaScript (and access-matrix.spec.ts
// can find the action id).
export function submitKeepingValues(dispatch: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(data));
  };
}
