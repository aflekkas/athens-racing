// One bounded, idempotent cleanup in the existing Free-plan Durable Object.
// Preserve arena KV state, connection resume tokens and leaderboard tables.
export const LEGACY_TABLES = ['users', 'sessions', 'tickets', 'oauth_states',
  'account_credentials', 'account_devices', 'auth_limits', 'social_migrations',
  'friend_requests', 'blocks', 'recent', 'customization_manifests', 'customization_assets'];
export async function cleanupLegacyStorage(storage) {
  const marker = 'local-driver-cleanup-v1';
  if (await storage.get(marker)) return;
  storage.transactionSync(() => { for (const table of LEGACY_TABLES) storage.sql.exec(`DROP TABLE IF EXISTS ${table}`); });
  await storage.put(marker, true);
}
