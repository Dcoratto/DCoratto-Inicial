import {
  enqueueMutation,
  listPendingMutations,
  markMutationFailed,
  markMutationSynced,
  saveLocalProjectSnapshot,
} from './offlinePersistence';

const PROJECT_ID_KEY = 'dcoratto.active.project.id.v1';

let queueFlushPromise = null;

export function getActiveProjectId(actor = null) {
  const existing = localStorage.getItem(activeProjectIdKey(actor));
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(activeProjectIdKey(actor), id);
  return id;
}

export function setActiveProjectId(id, actor = null) {
  if (!id) return;
  localStorage.setItem(activeProjectIdKey(actor), id);
}

export function createNewActiveProjectId(actor = null) {
  const id = crypto.randomUUID();
  setActiveProjectId(id, actor);
  return id;
}

function activeProjectIdKey(actor = null) {
  const email = String(actor?.email || currentActorEmail() || '').trim().toLowerCase();
  return email ? `${PROJECT_ID_KEY}.${email}` : PROJECT_ID_KEY;
}

function currentActorEmail() {
  try {
    return JSON.parse(sessionStorage.getItem('dcoratto.current.actor.v1') || 'null')?.email || '';
  } catch {
    return '';
  }
}

export function readOfflineQueue() {
  return listPendingMutations().catch(() => []);
}

export async function persistEditorEvent({ action, actor, draft, preview, settings, settingsMutation = null, saveHtml = false }) {
  if (actor?.email) sessionStorage.setItem('dcoratto.current.actor.v1', JSON.stringify(actor));
  const payload = {
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    action,
    actor,
    draft: draft || null,
    preview: preview || null,
    settings: settings || null,
    settingsMutation: settingsMutation || null,
    saveHtml,
    createdAt: new Date().toISOString(),
  };
  payload.id = payload.eventId;

  const projectId = getActiveProjectId(actor);
  if (draft || preview || settings) {
    saveLocalProjectSnapshot(projectId, {
      draft: draft || null,
      preview: preview || null,
      settings: settings || null,
      settingsMutation: settingsMutation || null,
      action,
      actor: actor || null,
    }).catch((error) => console.warn('Nao foi possivel salvar snapshot local no IndexedDB.', error));
  }

  if (saveHtml && preview?.environments) {
    try {
      const result = await publishClientHtmlWithServer(payload);
      if (result?.projectId) setActiveProjectId(result.projectId, actor);
      await flushOfflineQueue();
      return result;
    } catch (error) {
      console.warn('Persistencia do link pelo servidor indisponivel. Evento mantido na fila local para reenvio.', error);
      await enqueue(payload);
      return { source: 'server-error', projectId: getActiveProjectId(actor), error: String(error?.message || error), queued: true };
    }
  }

  if (draft || preview || settings) {
    try {
      const result = await persistEditorEventWithServer(payload);
      if (result?.projectId) setActiveProjectId(result.projectId, actor);
      await flushOfflineQueue();
      return result;
    } catch (error) {
      console.warn('Persistencia pelo servidor indisponivel. Evento mantido na fila local para reenvio.', error);
    }
  }

  await enqueue(payload);
  return { source: 'local-queue', projectId: getActiveProjectId(actor), error: 'server_unavailable' };
}

export async function loadLatestEditorState(actor, projectId = '') {
  if (actor?.email) sessionStorage.setItem('dcoratto.current.actor.v1', JSON.stringify(actor));
  const params = new URLSearchParams();
  if (actor?.email) params.set('actor', actor.email);
  if (projectId) params.set('projectId', projectId);
  const response = await fetch(`/api/editor-state/latest?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.error || 'Nao foi possivel carregar o rascunho remoto.');
  }
  const result = await response.json();
  if (result?.projectId) setActiveProjectId(result.projectId, actor);
  return result;
}

export async function loadRemoteEditorSettings() {
  const response = await fetch('/api/editor-settings', { cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || 'Nao foi possivel carregar configuracoes compartilhadas.');
  }
  return result.settings || null;
}

export async function saveRemoteEditorSettings(settings, actor, settingsMutation = null) {
  const response = await fetch('/api/editor-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings, actor, settingsMutation }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || 'Nao foi possivel salvar configuracoes compartilhadas.');
  }
  return result.settings || settings || null;
}

async function persistEditorEventWithServer(event) {
  const response = await fetch('/api/editor-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: getActiveProjectId(event.actor),
      actor: event.actor,
      action: event.action,
      draft: event.draft,
      preview: event.preview,
      settings: event.settings,
      settingsMutation: event.settingsMutation || null,
      eventId: event.eventId || event.id,
      createdAt: event.createdAt,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || 'Servidor recusou a persistencia do editor.');
  }
  return {
    source: result.source || 'server',
    projectId: result.projectId || getActiveProjectId(event.actor),
  };
}

export async function flushOfflineQueue() {
  if (queueFlushPromise) return queueFlushPromise;
  queueFlushPromise = flushOfflineQueueNow().finally(() => {
    queueFlushPromise = null;
  });
  return queueFlushPromise;
}

async function flushOfflineQueueNow() {
  const queue = await readOfflineQueue();
  if (!queue.length) return;

  for (const event of queue) {
    try {
      const result = event.saveHtml && event.preview?.environments
        ? await publishClientHtmlWithServer(event)
        : await persistEditorEventWithServer(event);
      if (result?.projectId) setActiveProjectId(result.projectId, event.actor);
      await markMutationSynced(event.id);
    } catch (error) {
      await markMutationFailed(event.id, error);
      console.warn('Falha ao reenviar evento persistente', error);
    }
  }
}

async function publishClientHtmlWithServer(event) {
  const projectId = getActiveProjectId(event.actor);
  const response = await fetch('/api/client-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      actor: event.actor,
      draft: event.draft,
      preview: event.preview,
      eventId: event.eventId || event.id,
      createdAt: event.createdAt,
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result?.publicUrl) {
    throw new Error(result?.error || 'Nao foi possivel gerar o link persistente do cliente.');
  }

  return {
    source: result.source || 'server',
    projectId: result.projectId || projectId,
    htmlVersion: {
      storage_path: result.storagePath || '',
      data: {
        publicUrl: result.publicUrl,
        storagePublicUrl: result.storagePublicUrl || '',
        storageError: result.storageError || '',
      },
    },
  };
}

async function enqueue(event) {
  return enqueueMutation({
    id: event.id,
    eventId: event.eventId || event.id,
    projectId: getActiveProjectId(event.actor),
    action: event.action,
    actor: event.actor,
    draft: event.draft || null,
    preview: event.preview || null,
    settings: event.settings || null,
    settingsMutation: event.settingsMutation || null,
    saveHtml: Boolean(event.saveHtml),
    createdAt: event.createdAt,
  });
}

if (typeof window !== 'undefined' && window.navigator?.onLine !== false) {
  flushOfflineQueue().catch((error) => console.warn('Falha ao limpar fila offline na inicializacao:', error));
  window.addEventListener('online', () => flushOfflineQueue().catch((error) => console.warn('Falha ao reenviar fila offline apos reconexao:', error)));
}
