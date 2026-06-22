const DB_NAME = 'dcoratto-offline-persistence';
const DB_VERSION = 2;
const DRAFTS_STORE = 'draftSnapshots';
const SNAPSHOTS_STORE = 'projectSnapshots';
const MUTATIONS_STORE = 'mutations';
const ASSETS_STORE = 'pendingAssets';

let dbPromise = null;

export function openDcorattoDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponivel neste navegador.'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        const store = db.createObjectStore(DRAFTS_STORE, { keyPath: 'id' });
        store.createIndex('user_project', ['userEmail', 'projectId'], { unique: true });
        store.createIndex('user_updatedAt', ['userEmail', 'localUpdatedAt'], { unique: false });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        const store = db.createObjectStore(MUTATIONS_STORE, { keyPath: 'id' });
        store.createIndex('status_createdAt', ['status', 'createdAt'], { unique: false });
        store.createIndex('eventId', 'eventId', { unique: false });
        store.createIndex('user_status_createdAt', ['userEmail', 'status', 'createdAt'], { unique: false });
      } else {
        const store = request.transaction.objectStore(MUTATIONS_STORE);
        if (!store.indexNames.contains('user_status_createdAt')) {
          store.createIndex('user_status_createdAt', ['userEmail', 'status', 'createdAt'], { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        const store = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
        store.createIndex('status_createdAt', ['status', 'createdAt'], { unique: false });
        store.createIndex('user_project', ['userEmail', 'projectId'], { unique: false });
      } else {
        const store = request.transaction.objectStore(ASSETS_STORE);
        if (!store.indexNames.contains('user_project')) {
          store.createIndex('user_project', ['userEmail', 'projectId'], { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function saveLocalProjectSnapshot(projectId, snapshot) {
  if (!projectId) return null;
  const userEmail = normalizeEmail(snapshot?.actor?.email || snapshot?.userEmail || '');
  if (userEmail) {
    await saveLocalDraftSnapshot(projectId, userEmail, snapshot).catch(() => null);
  }
  const existing = await getRecord(SNAPSHOTS_STORE, projectId).catch(() => null);
  const previous = existing?.snapshot || {};
  const incoming = snapshot || {};
  const now = new Date().toISOString();
  const mergedSnapshot = {
    ...previous,
    ...incoming,
    draft: incoming.draft || previous.draft || null,
    preview: incoming.preview || previous.preview || null,
    settings: incoming.settings || previous.settings || null,
    settingsMutation: incoming.settingsMutation || previous.settingsMutation || null,
    action: incoming.action || previous.action || '',
    projectId: incoming.projectId || previous.projectId || projectId,
    status: incoming.status || previous.status || '',
    snapshotUpdatedAt: now,
    actor: incoming.actor || previous.actor || null,
  };
  const record = {
    projectId,
    snapshot: mergedSnapshot,
    updatedAt: now,
  };
  await putRecord(SNAPSHOTS_STORE, record);
  return record;
}

export async function loadLocalProjectSnapshot(projectId) {
  if (!projectId) return null;
  const record = await getRecord(SNAPSHOTS_STORE, projectId);
  return record?.snapshot || null;
}

export async function saveLocalDraftSnapshot(projectId, userEmail, snapshot) {
  const email = normalizeEmail(userEmail || snapshot?.actor?.email || snapshot?.userEmail || '');
  if (!projectId || !email) return null;
  const id = draftSnapshotId(projectId, email);
  const existing = await getRecord(DRAFTS_STORE, id).catch(() => null);
  const previous = existing?.snapshot || {};
  const incoming = snapshot || {};
  const now = new Date().toISOString();
  const revision = Number(incoming.revision || previous.revision || existing?.revision || 0) + 1;
  const mergedSnapshot = {
    ...previous,
    ...incoming,
    projectId,
    userEmail: email,
    actor: incoming.actor || previous.actor || null,
    draft: incoming.draft || previous.draft || null,
    preview: incoming.preview || previous.preview || null,
    settings: incoming.settings || previous.settings || null,
    settingsMutation: incoming.settingsMutation || previous.settingsMutation || null,
    canonicalPage: incoming.canonicalPage || previous.canonicalPage || null,
    uiState: incoming.uiState || previous.uiState || null,
    action: incoming.action || previous.action || '',
    status: incoming.status || previous.status || 'draft',
    syncStatus: incoming.syncStatus || 'dirty',
    revision,
    localUpdatedAt: now,
    remoteUpdatedAt: incoming.remoteUpdatedAt || previous.remoteUpdatedAt || '',
    snapshotUpdatedAt: now,
  };
  const record = {
    id,
    projectId,
    userEmail: email,
    revision,
    localUpdatedAt: now,
    updatedAt: now,
    syncStatus: mergedSnapshot.syncStatus,
    snapshot: mergedSnapshot,
  };
  await putRecord(DRAFTS_STORE, record);
  return record;
}

export async function loadLocalDraftSnapshot(projectId, userEmail) {
  const email = normalizeEmail(userEmail);
  if (!projectId || !email) return null;
  const record = await getRecord(DRAFTS_STORE, draftSnapshotId(projectId, email)).catch(() => null);
  if (record?.snapshot) return record.snapshot;
  return loadLocalProjectSnapshot(projectId).catch(() => null);
}

export async function enqueueMutation(mutation) {
  const now = new Date().toISOString();
  const actorEmail = normalizeEmail(mutation.userEmail || mutation.actor?.email || '');
  const record = {
    id: mutation.id || mutation.eventId || crypto.randomUUID(),
    eventId: mutation.eventId || mutation.id || crypto.randomUUID(),
    projectId: mutation.projectId || '',
    userEmail: actorEmail,
    actor: mutation.actor || null,
    action: mutation.action || 'editor_sync',
    payload: mutation.payload || null,
    draft: mutation.draft || null,
    preview: mutation.preview || null,
    settings: mutation.settings || null,
    settingsMutation: mutation.settingsMutation || null,
    saveHtml: Boolean(mutation.saveHtml),
    assetIds: Array.isArray(mutation.assetIds) ? mutation.assetIds : [],
    createdAt: mutation.createdAt || now,
    updatedAt: now,
    retryCount: Number(mutation.retryCount || 0),
    status: mutation.status || 'pending',
    lastError: mutation.lastError || '',
  };
  await putRecord(MUTATIONS_STORE, record);
  return record;
}

export const saveLocalMutation = enqueueMutation;

export async function listPendingMutations(userEmail = '') {
  const email = normalizeEmail(userEmail);
  const records = await getAllRecords(MUTATIONS_STORE);
  return records
    .filter(record => record.status !== 'synced')
    .filter(record => !email || normalizeEmail(record.userEmail || record.actor?.email || '') === email)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export async function markMutationSynced(id) {
  if (!id) return;
  const record = await getRecord(MUTATIONS_STORE, id);
  if (!record) return;
  await putRecord(MUTATIONS_STORE, {
    ...record,
    status: 'synced',
    syncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function markMutationFailed(id, error) {
  if (!id) return;
  const record = await getRecord(MUTATIONS_STORE, id);
  if (!record) return;
  await putRecord(MUTATIONS_STORE, {
    ...record,
    status: 'pending',
    retryCount: Number(record.retryCount || 0) + 1,
    lastError: String(error?.message || error || ''),
    updatedAt: new Date().toISOString(),
  });
}

export async function savePendingAsset(asset) {
  const now = new Date().toISOString();
  const userEmail = normalizeEmail(asset.userEmail || asset.actor?.email || '');
  const record = {
    id: asset.id || crypto.randomUUID(),
    projectId: asset.projectId || '',
    userEmail,
    blob: asset.blob || asset.file || null,
    thumbnailBlob: asset.thumbnailBlob || asset.thumbBlob || null,
    metadata: asset.metadata || {},
    thumbnailMetadata: asset.thumbnailMetadata || asset.thumbMetadata || null,
    actor: asset.actor || null,
    createdAt: asset.createdAt || now,
    updatedAt: now,
    retryCount: Number(asset.retryCount || 0),
    status: asset.status || 'pending',
  };
  await putRecord(ASSETS_STORE, record);
  return record;
}

export const saveLocalAsset = savePendingAsset;

export function getPendingAsset(id) {
  return getRecord(ASSETS_STORE, id);
}

export const getLocalAsset = getPendingAsset;

export function deletePendingAsset(id) {
  return deleteRecord(ASSETS_STORE, id);
}

export const deleteLocalAsset = deletePendingAsset;

function draftSnapshotId(projectId, userEmail) {
  return `${normalizeEmail(userEmail)}::${projectId}`;
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

async function putRecord(storeName, value) {
  const db = await openDcorattoDb();
  return transactionRequest(db, storeName, 'readwrite', store => store.put(value));
}

async function getRecord(storeName, key) {
  const db = await openDcorattoDb();
  return transactionRequest(db, storeName, 'readonly', store => store.get(key));
}

async function getAllRecords(storeName) {
  const db = await openDcorattoDb();
  return transactionRequest(db, storeName, 'readonly', store => store.getAll());
}

async function deleteRecord(storeName, key) {
  const db = await openDcorattoDb();
  return transactionRequest(db, storeName, 'readwrite', store => store.delete(key));
}

function transactionRequest(db, storeName, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
