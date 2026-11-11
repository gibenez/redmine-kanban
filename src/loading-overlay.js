// Track logical operations, not individual requests: sequential reads and writes
// must not briefly unlock the UI between requests.
export function createLoadingOverlay(dialog) {
  let pending = 0;
  dialog.addEventListener('cancel', event => event.preventDefault());
  return function begin() {
    if (pending++ === 0) dialog.showModal();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--pending === 0) dialog.close();
    };
  };
}
