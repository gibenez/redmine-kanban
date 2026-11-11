// Wait for sibling requests even on failure so a logical operation cannot
// release its loading overlay while another request is still running.
export async function settledResults(promises) {
  const results = await Promise.allSettled(promises);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}
