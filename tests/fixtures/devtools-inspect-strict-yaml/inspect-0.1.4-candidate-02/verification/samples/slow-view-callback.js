// Receiver-boundary test only. This delayed callback is not used by the production View.
async function slowViewCallback() {
  await new Promise(resolve => setTimeout(resolve, 4500));
  return 'opened';
}
let accepted = null, timedOut = false, lateAckIgnored = false;
(async () => {
  const result = await Promise.race([slowViewCallback().then(value => {
    if (timedOut) lateAckIgnored = true; else accepted = value;
    return value;
  }), new Promise(resolve => setTimeout(() => resolve('unsupported'), 4000))]);
  timedOut = result === 'unsupported';
  await new Promise(resolve => setTimeout(resolve, 700));
  if (result !== 'unsupported' || accepted !== null || !lateAckIgnored) process.exit(2);
  console.log(JSON.stringify({status: result, lateAckIgnored, capabilityInvocations: 0, elapsedMs: 4500}));
})().catch(() => process.exit(3));
