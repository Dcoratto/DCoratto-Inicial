import {
  enqueueMutation,
  listPendingMutations,
  markMutationFailed,
  markMutationSynced,
  saveLocalProjectSnapshot,
} from './offlinePersistence';

const PROJECT_ID_KEY = 'dcoratto.active.project.id.v1';

let queueFlushPromise = null;

class ApiRequestError extends Error {
  constructor({ message, code = 'server_error', retryable = false, status = 0 } = {}) {
    super(message || 'Nao foi possivel completar a solicitacao.');
    this.name = 'ApiRequestError';
    this.code = code;
    this.retryable = Boolean(retryable);
    this.status = status;
  }
}

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

export async function persistEditorEvent({ id = '', eventId = '', action, actor, draft, preview, settings, settingsMutation = null, saveHtml = false }) {
  if (actor?.email) sessionStorage.setItem('dcoratto.current.actor.v1', JSON.stringify(actor));
  const payload = {
    id: id || eventId || crypto.randomUUID(),
    eventId: eventId || id || crypto.randomUUID(),
    action,
    actor,
    draft: draft || null,
    preview: preview || null,
    settings: settings || null,
    settingsMutation: settingsMutation || null,
    saveHtml,
    createdAt: new Date().toISOString(),
  };
  payload.eventId = payload.eventId || payload.id || crypto.randomUUID();
  payload.id = payload.id || payload.eventId;

  const projectId = getActiveProjectId(actor);
  if (draft || preview || settings) {
    const snapshot = {
      projectId,
      userEmail: actor?.email || '',
      draft: draft || null,
      preview: preview || null,
      settings: settings || null,
      settingsMutation: settingsMutation || null,
      action,
      status: action === 'save_as_draft' ? 'draft' : undefined,
      actor: actor || null,
      syncStatus: 'dirty',
    };
    await saveLocalProjectSnapshot(projectId, snapshot).catch((error) => console.warn('Nao foi possivel salvar snapshot local no IndexedDB.', error));
  }

  await enqueue({
    ...payload,
    projectId,
    status: 'pending',
  });

  if (saveHtml && preview?.environments) {
    try {
      const result = await publishClientHtmlWithServer(payload);
      if (result?.projectId) setActiveProjectId(result.projectId, actor);
      await markMutationSynced(payload.id);
      await flushOfflineQueue();
      return result;
    } catch (error) {
      console.warn('Persistencia do link pelo servidor indisponivel. Evento mantido na fila local para reenvio.', error);
      await markMutationFailed(payload.id, normalizeRequestError(error));
      await enqueue(payload);
      return { source: 'server-error', projectId: getActiveProjectId(actor), error: cleanApiErrorMessage(error), retryable: isRetryableRequestError(error), queued: true };
    }
  }

  if (draft || preview || settings) {
    try {
      const result = await persistEditorEventWithServer(payload);
      if (result?.projectId) setActiveProjectId(result.projectId, actor);
      await markMutationSynced(payload.id);
      await flushOfflineQueue();
      return result;
    } catch (error) {
      console.warn('Persistencia pelo servidor indisponivel. Evento mantido na fila local para reenvio.', error);
      await markMutationFailed(payload.id, normalizeRequestError(error));
    }
  }

  await enqueue(payload);
  return { source: 'local-queue', projectId: getActiveProjectId(actor), error: 'server_unavailable', retryable: true, queued: true };
}

export async function loadLatestEditorState(actor, projectId = '') {
  if (actor?.email) sessionStorage.setItem('dcoratto.current.actor.v1', JSON.stringify(actor));
  const params = new URLSearchParams();
  if (actor?.email) params.set('actor', actor.email);
  if (projectId) params.set('projectId', projectId);
  const response = await fetch(`/api/editor-state/latest?${params.toString()}`, {
    cache: 'no-store',
  });
  const result = await readApiResponse(response, 'Nao foi possivel carregar o rascunho remoto.');
  if (result?.projectId) setActiveProjectId(result.projectId, actor);
  return result;
}

export async function loadRemoteEditorSettings() {
  const response = await fetch('/api/editor-settings', { cache: 'no-store' });
  const result = await readApiResponse(response, 'Nao foi possivel carregar configuracoes compartilhadas.');
  return result.settings || null;
}

export async function saveRemoteEditorSettings(settings, actor, settingsMutation = null) {
  const response = await fetch('/api/editor-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings, actor, settingsMutation }),
  });
  const result = await readApiResponse(response, 'Nao foi possivel salvar configuracoes compartilhadas.');
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
  const result = await readApiResponse(response, 'Servidor recusou a persistencia do editor.');
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
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
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
      const normalizedError = normalizeRequestError(error);
      await markMutationFailed(event.id, normalizedError);
      console.warn('Falha ao reenviar evento persistente', error);
      if (normalizedError.retryable) break;
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
  const result = await readApiResponse(response, 'Nao foi possivel gerar o link persistente do cliente.');
  if (!result?.publicUrl) {
    throw new ApiRequestError({
      message: result?.message || result?.error || 'Nao foi possivel gerar o link persistente do cliente.',
      code: result?.error || 'client_link_error',
      retryable: Boolean(result?.retryable),
      status: response.status,
    });
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

async function readApiResponse(response, fallbackMessage) {
  const text = await response.text().catch(() => '');
  const result = parseApiPayload(text);
  if (!response.ok || result?.ok === false) {
    throw new ApiRequestError({
      message: result?.message || cleanApiErrorMessage(result?.error || text || fallbackMessage),
      code: result?.error || (looksLikeHtmlError(text) ? 'supabase_unavailable' : 'server_error'),
      retryable: Boolean(result?.retryable || looksLikeHtmlError(text)),
      status: response.status,
    });
  }
  return result || {};
}

function parseApiPayload(text = '') {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return looksLikeHtmlError(text)
      ? {
          ok: false,
          error: 'supabase_unavailable',
          message: 'Supabase temporariamente indisponivel. Seus dados locais foram preservados e a sincronizacao sera tentada novamente.',
          retryable: true,
        }
      : { ok: false, error: 'server_error', message: cleanApiErrorMessage(text), retryable: false };
  }
}

function looksLikeHtmlError(value = '') {
  return /<!doctype html|<html[\s>]|<\/html>|cloudflare|connection timed out|error code 522|supabase\.co|gateway timeout|service unavailable/i
    .test(String(value || ''));
}

function cleanApiErrorMessage(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return 'Nao foi possivel completar a solicitacao agora.';
  if (looksLikeHtmlError(raw)) {
    return 'Supabase temporariamente indisponivel. Seus dados locais foram preservados e a sincronizacao sera tentada novamente.';
  }
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 280);
}

function isRetryableRequestError(error) {
  if (error?.retryable) return true;
  const raw = String(error?.message || error || '').toLowerCase();
  return looksLikeHtmlError(raw)
    || /failed to fetch|networkerror|load failed|offline|timeout|aborterror|connection/i.test(raw);
}

function normalizeRequestError(error) {
  if (error instanceof ApiRequestError) return error;
  return new ApiRequestError({
    message: cleanApiErrorMessage(error),
    code: isRetryableRequestError(error) ? 'supabase_unavailable' : 'server_error',
    retryable: isRetryableRequestError(error),
  });
}

async function enqueue(event) {
  return enqueueMutation({
    id: event.id,
    eventId: event.eventId || event.id,
    projectId: getActiveProjectId(event.actor),
    userEmail: event.actor?.email || '',
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
