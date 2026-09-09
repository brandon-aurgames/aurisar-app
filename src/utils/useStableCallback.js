import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns a function whose identity never changes but which always calls the
 * latest render's version of `fn`.
 *
 * For handlers that read live state (so a plain `useCallback([])` would trap
 * stale closures) but are passed into memo'd subtrees (so a fresh function
 * every render would defeat the memo). The ref updates in useLayoutEffect,
 * before any event handler can run against the new render's output.
 *
 * Do not call the returned function during render — it is for event handlers
 * and effects.
 */
export function useStableCallback(fn) {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args) => ref.current(...args), []);
}
