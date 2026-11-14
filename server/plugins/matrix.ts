// Posts card activity into Matrix threads as soon as it is queued (NOTIFY
// matrix_deliveries at commit), and whatever is already due at startup.
// Retries come from the matrix:deliver task.
export default defineNitroPlugin(() => {
  const run = () => deliverMatrixActivity().catch(err => console.error('Matrix delivery failed:', err))
  onMatrixQueued(run).then(run).catch(err => console.error('Could not listen for Matrix deliveries:', err))
})
