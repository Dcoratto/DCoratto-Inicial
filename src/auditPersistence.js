const PROJECT_ID_KEY = 'dcoratto.active.project.id.v1';
const OFFLINE_QUEUE_KEY = 'dcoratto.persistence.queue.v1';
const MAX_QUEUE_EVENTS = 25;
const MAX_QUEUE_BYTES = 8_000_000;

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
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export async function persistEditorEvent({ action, actor, draft, preview, settings, saveHtml = false }) {
  if (actor?.email) sessionStorage.setItem('dcoratto.current.actor.v1', JSON.stringify(actor));
  const payload = {
    id: crypto.randomUUID(),
    action,
    actor,
    draft: draft || null,
    preview: preview || null,
    settings: settings || null,
    saveHtml,
    createdAt: new Date().toISOString(),
  };

  if (saveHtml && preview?.environments) {
    try {
      const result = await publishClientHtmlWithServer(payload);
      if (result?.projectId) setActiveProjectId(result.projectId, actor);
      await flushOfflineQueue();
      return result;
    } catch (error) {
      console.warn('Persistencia do link pelo servidor indisponivel. Evento mantido na fila local para reenvio.', error);
      enqueue(payload);
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

  enqueue(payload);
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
      eventId: event.id,
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
  const queue = readOfflineQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const event of queue) {
    try {
      const result = event.saveHtml && event.preview?.environments
        ? await publishClientHtmlWithServer(event)
        : await persistEditorEventWithServer(event);
      if (result?.projectId) setActiveProjectId(result.projectId, event.actor);
    } catch (error) {
      remaining.push(event);
      console.warn('Falha ao reenviar evento persistente', error);
    }
  }

  writeOfflineQueue(remaining);
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
      eventId: event.id,
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

function enqueue(event) {
  const queue = readOfflineQueue();
  queue.push(compactQueuedEvent(event));
  writeOfflineQueue(queue);
}

function writeOfflineQueue(events) {
  const queue = events.filter(Boolean).slice(-MAX_QUEUE_EVENTS).map(compactQueuedEvent);
  while (queue.length) {
    const serialized = JSON.stringify(queue);
    if (serialized.length <= MAX_QUEUE_BYTES && trySetQueue(serialized)) return;
    queue.shift();
  }
  trySetQueue('[]');
}

function trySetQueue(serialized) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, serialized);
    return true;
  } catch (error) {
    console.warn('Fila local cheia. Eventos antigos foram descartados para manter o editor responsivo.', error);
    return false;
  }
}

function compactQueuedEvent(event) {
  return {
    id: event.id,
    action: event.action,
    actor: event.actor,
    draft: event.draft || null,
    preview: event.preview || null,
    settings: event.settings || null,
    saveHtml: Boolean(event.saveHtml),
    createdAt: event.createdAt,
  };
}

if (typeof window !== 'undefined' && window.navigator?.onLine !== false) {
  flushOfflineQueue().catch((error) => console.warn('Falha ao limpar fila offline na inicializacao:', error));
  window.addEventListener('online', () => flushOfflineQueue().catch((error) => console.warn('Falha ao reenviar fila offline apos reconexao:', error)));
}
