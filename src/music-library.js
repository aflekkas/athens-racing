// Handles stay on this device. File picker fallback files are session-only.
import { isMusicFile } from './music-sources.js';
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('paraliaki.music-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function savedHandles(value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('library', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('library');
      const request = value === undefined ? store.get('handles') : store.put(value, 'handles');
      transaction.oncomplete = () => resolve(value === undefined ? request.result || [] : value);
      transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function filesFromHandles(handles, requestPermission = false) {
  const files = [];
  async function read(handle) {
    if (files.length >= 500) return;
    if (handle.kind === 'file') { const file = await handle.getFile(); if (isMusicFile(file)) files.push(file); }
    else for await (const entry of handle.values()) await read(entry);
  }
  for (const handle of handles) {
    let permission = await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted' && requestPermission) permission = await handle.requestPermission({ mode: 'read' });
    if (permission !== 'granted') throw Error('Choose Restore again and allow access, or choose your files again.');
    await read(handle);
  }
  return files;
}
