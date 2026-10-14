// Uses the existing free-plan Durable Object SQLite; no new infrastructure.
export function createMemoryCustomizationStore(){
  const manifests=new Map(),assets=new Map();
  return {getManifest:owner=>manifests.get(owner),putManifest:(owner,data)=>manifests.set(owner,structuredClone(data)),getAsset:id=>assets.get(id),listAssets:owner=>[...assets.values()].filter(a=>a.owner===owner),putAsset:a=>assets.set(a.id,a),deleteAsset:id=>assets.delete(id),totalBytes:()=>[...assets.values()].reduce((n,a)=>n+a.bytes.byteLength,0)};
}
export function createSqlCustomizationStore(sql){
  sql.exec(`CREATE TABLE IF NOT EXISTS customization_manifests (owner TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customization_assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes BLOB NOT NULL, createdAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS customization_assets_owner ON customization_assets(owner);`);
  const getAsset=id=>[...sql.exec('SELECT * FROM customization_assets WHERE id = ?',id)][0];
  return {
    getManifest:owner=>{const row=[...sql.exec('SELECT data FROM customization_manifests WHERE owner = ?',owner)][0];return row?JSON.parse(row.data):undefined;},
    putManifest:(owner,data)=>sql.exec('INSERT OR REPLACE INTO customization_manifests VALUES (?, ?)',owner,JSON.stringify(data)),
    getAsset,
    listAssets:owner=>[...sql.exec('SELECT id, type, width, height, createdAt, length(bytes) AS size FROM customization_assets WHERE owner = ?',owner)],
    putAsset:a=>sql.exec('INSERT INTO customization_assets VALUES (?, ?, ?, ?, ?, ?, ?)',a.id,a.owner,a.type,a.width,a.height,a.bytes,a.createdAt),
    deleteAsset:id=>sql.exec('DELETE FROM customization_assets WHERE id = ?',id),
    totalBytes:()=>[...sql.exec('SELECT COALESCE(SUM(length(bytes)), 0) AS size FROM customization_assets')][0].size,
  };
}
