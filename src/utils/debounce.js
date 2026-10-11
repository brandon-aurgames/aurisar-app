/**
 * Trailing debounce with cancel, so a Clear can drop a pending search
 * instead of letting it restore the stale query after 200ms.
 */
export function debounce(fn, ms) {
  let id = null;
  function wrapped(...args) {
    if (id != null) clearTimeout(id);
    id = setTimeout(() => {
      id = null;
      fn(...args);
    }, ms);
  }
  wrapped.cancel = () => {
    if (id != null) {
      clearTimeout(id);
      id = null;
    }
  };
  return wrapped;
}
