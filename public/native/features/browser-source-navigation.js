export async function navigateToBrowserSource(url, { scope, activate, isActive, open }) {
  if (!scope.workspaceId || !scope.isCurrent()) return;
  await activate();
  const current = () => isActive() && scope.isCurrent();
  if (current()) await open(url, current);
}
