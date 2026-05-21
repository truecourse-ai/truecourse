import * as React from 'react';

type Handler = () => void;

export function buildNoOpUnsubscribe(): Handler {
  return () => {};
}

export function pickCallback(cb?: Handler): Handler {
  return cb || (() => {});
}

export function NoOpButton(): React.ReactElement {
  return <button onClick={() => {}}>idle</button>;
}
