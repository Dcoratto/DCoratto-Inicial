import { isSupabaseConfigured, supabase } from './supabaseClient';

const PROJECT_ID_KEY = 'dcoratto.active.project.id.v1';
const OFFLINE_QUEUE_KEY = 'dcoratto.persistence.queue.v1';
const ENVIRONMENT_ID_KEY = 'dcoratto.environment.ids.v1';
const HTML_BUCKET = import.meta.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';
const MAX_QUEUE_EVENTS = 25;
const MAX_QUEUE_BYTES = 1_200_000;
let warnedMissingSession = false;

export function getActiveProjectId() {
  const existing = localStorage.getItem(activeProjectIdKey());
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(activeProjectIdKey(), id);
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
    const result = await publishClientHtmlWithServer(payload);
    if (result?.projectId) setActiveProjectId(result.projectId, actor);
    return result;
  }

  if (draft || preview || settings) {
    try {
      const result = await persistEditorEventWithServer(payload);
      if (result?.projectId) setActiveProjectId(result.projectId, actor);
      return result;
    } catch (error) {
      console.warn('Persistencia pelo servidor indisponivel; tentando fallback.', error);
    }
  }

  if (!isSupabaseConfigured || !supabase) {
    enqueue(payload);
    return { source: 'local-queue', projectId: getActiveProjectId() };
  }

  if (!(await hasSupabaseSession())) {
    enqueue(payload);
    return { source: 'local-queue', projectId: getActiveProjectId(), error: 'missing_supabase_session' };
  }

  try {
    const result = await writeEvent(payload);
    await flushOfflineQueue();
    return result;
  } catch (error) {
    console.warn('Falha ao persistir evento do editor. Evento mantido na fila local.', error);
    enqueue(payload);
    return { source: 'local-queue', projectId: getActiveProjectId(), error };
  }
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
      projectId: getActiveProjectId(),
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
    source: result.source || 'server-supabase',
    projectId: result.projectId || getActiveProjectId(),
  };
}

export async function flushOfflineQueue() {
  if (!isSupabaseConfigured || !supabase) return;
  if (!(await hasSupabaseSession())) return;

  const queue = readOfflineQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const event of queue) {
    try {
      await writeEvent(event);
    } catch (error) {
      remaining.push(event);
      console.warn('Falha ao reenviar evento persistente', error);
    }
  }

  writeOfflineQueue(remaining);
}

async function hasSupabaseSession() {
  try {
    const { data } = await supabase.auth.getSession();
    const hasSession = Boolean(data?.session?.access_token);
    if (!hasSession && !warnedMissingSession) {
      warnedMissingSession = true;
      console.warn('Supabase configurado, mas sem sessao autenticada. Eventos serao mantidos na fila local compacta.');
    }
    return hasSession;
  } catch (error) {
    console.warn('Nao foi possivel verificar a sessao do Supabase.', error);
    return false;
  }
}

async function writeEvent(event) {
  if (!event.preview && !event.draft) {
    if (event.settings) {
      await supabase.from('editor_settings').upsert({
        settings_key: 'default',
        payload: event.settings,
        updated_by: event.actor?.email || '',
      }, { onConflict: 'settings_key' });
    }
    const { error } = await supabase.from('editor_audit_logs').insert({
      event_id: event.id,
      actor_email: event.actor?.email || '',
      action: event.action || 'app_event',
      payload: { actor: event.actor, settings: event.settings || null },
    });
    if (error) throw error;
    return { source: 'supabase', projectId: null };
  }

  const projectId = getActiveProjectId();
  const preview = event.preview || {};
  const draft = event.draft || {};
  const client = preview.client || {};
  const environments = Array.isArray(preview.environments) ? preview.environments : [];

  const projectPayload = {
    id: projectId,
    title: preview.projectType || 'Projeto Inicial',
    client_name: client.name || draft.fields?.clientName || '',
    contract_number: client.contractNumber || draft.fields?.contractNum || '',
    factory: Array.isArray(client.manufacturers) ? client.manufacturers.join(' + ') : '',
    address: client.address || draft.fields?.endereco || '',
    document_type: 'projeto_inicial',
    status: 'draft',
    owner_email: event.actor?.primaryAccountEmail || 'dcorattoinovacao@gmail.com',
    created_by: event.actor?.email || '',
    updated_by: event.actor?.email || '',
    data: {
      actor: event.actor,
      lastAction: event.action,
      lastEventId: event.id,
      lastEventAt: event.createdAt,
      draft,
      preview,
      ownerEmail: event.actor?.primaryAccountEmail || 'dcorattoinovacao@gmail.com',
    },
  };

  const { error: projectError } = await supabase
    .from('document_projects')
    .upsert(projectPayload);

  if (projectError) throw projectError;

  if (environments.length) {
    const environmentPayloads = environments.map((environment, index) => ({
      id: stableEnvironmentId(projectId, environment.title, index),
      project_id: projectId,
      position: index,
      name: environment.title || `Ambiente ${index + 1}`,
      subtitle: preview.projectType || 'Projeto Inicial',
      image_url: environment.photos?.[0]?.src?.startsWith('http') ? environment.photos[0].src : null,
      image_data: environment.photos?.[0]?.src?.startsWith('data:') ? environment.photos[0].src : null,
      colors: (environment.colors || []).map((color) => color.name || color),
      tamponamentos: environment.specs?.tamponamentos || '',
      portas: environment.specs?.portas || '',
      puxadores: environment.specs?.puxadores || '',
      corredicas: environment.specs?.corredicas || '',
      notes: environment.notes || [],
      data: environment,
    }));

    const { error: environmentsError } = await supabase
      .from('document_environments')
      .upsert(environmentPayloads);

    if (environmentsError) throw environmentsError;

    await persistEnvironmentPages(projectId, environments, environmentPayloads);
  }

  await supabase.from('document_versions').insert({
    project_id: projectId,
    snapshot: { draft, preview, actor: event.actor },
    reason: event.action || 'autosave',
  });

  await supabase.from('editor_audit_logs').upsert({
    project_id: projectId,
    actor_email: event.actor?.email || '',
    action: event.action || 'editor_event',
    payload: { draft, preview, settings: event.settings || null },
    event_id: event.id,
  }, { onConflict: 'event_id' });

  if (event.saveHtml && preview.environments) {
    const htmlVersion = await saveSharedHtml(projectId, preview, event.actor);
    return { source: 'supabase', projectId, htmlVersion };
  }

  return { source: 'supabase', projectId };
}

async function publishClientHtmlWithServer(event) {
  const projectId = getActiveProjectId();
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

async function persistEnvironmentPages(projectId, environments, environmentPayloads) {
  const { error: deleteError } = await supabase
    .from('environment_pages')
    .delete()
    .eq('project_id', projectId);

  if (deleteError) throw deleteError;

  const pagePayloads = environments.flatMap((environment, environmentIndex) => {
    const environmentId = environmentPayloads[environmentIndex]?.id;
    if (!environmentId || !Array.isArray(environment.pages)) return [];
    return environment.pages.map((page, pageIndex) => {
      const photo = page.photos?.[0] || {};
      return {
        project_id: projectId,
        environment_id: environmentId,
        position: pageIndex,
        title: page.title || `Página ${pageIndex + 1}`,
        description: page.description || '',
        image_url: photo.src?.startsWith('http') ? photo.src : null,
        image_data: photo.src?.startsWith('data:') ? photo.src : null,
        data: page,
      };
    });
  });

  if (!pagePayloads.length) return;

  const { error: pagesError } = await supabase
    .from('environment_pages')
    .insert(pagePayloads);

  if (pagesError) throw pagesError;
}

async function saveSharedHtml(projectId, preview, actor) {
  const versionNumber = await nextHtmlVersionNumber(projectId);
  const html = await buildStandaloneHtml(preview);
  const shareSlug = `${slugify(preview.client?.name || 'cliente')}-${String(versionNumber).padStart(3, '0')}-${crypto.randomUUID().slice(0, 8)}`;
  const storagePath = `${projectId}/cliente/${shareSlug}.html`;
  let publicUrl = '';
  let storageError = null;

  try {
    const file = new Blob([html], { type: 'text/html;charset=utf-8' });
    const { error } = await supabase.storage
      .from(HTML_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '60',
        contentType: 'text/html;charset=utf-8',
        upsert: true,
      });
    if (error) throw error;
    const { data } = supabase.storage.from(HTML_BUCKET).getPublicUrl(storagePath);
    publicUrl = data.publicUrl;
  } catch (error) {
    storageError = String(error?.message || error);
  }

  const { data, error } = await supabase
    .from('document_html_versions')
    .insert({
      project_id: projectId,
      version_number: versionNumber,
      title: `Projeto Inicial - ${preview.client?.name || 'Cliente'}`,
      html_content: html,
      storage_bucket: HTML_BUCKET,
      storage_path: storageError ? null : storagePath,
      is_current: true,
      shared_with_client: true,
      shared_at: new Date().toISOString(),
      created_by: actor?.email || '',
      owner_email: actor?.primaryAccountEmail || 'dcorattoinovacao@gmail.com',
      share_slug: shareSlug,
      data: {
        publicUrl,
        storageError,
        client: preview.client || {},
      },
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function buildStandaloneHtml(preview) {
  const response = await fetch('/portfolio_document.html', { cache: 'no-store' });
  const template = await response.text();
  const serialized = JSON.stringify(preview)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const hardening = `
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="referrer" content="no-referrer">
    <script>
      window.__DCORATTO_PORTFOLIO_DOCUMENT__ = ${serialized};
      window.__DCORATTO_CLIENT_VIEW__ = true;
      document.addEventListener('contextmenu', function(event) { event.preventDefault(); });
      document.addEventListener('keydown', function(event) {
        const key = String(event.key || '').toLowerCase();
        if (event.key === 'F12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i','j','c'].includes(key)) || ((event.ctrlKey || event.metaKey) && key === 'u')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);
    </script>`;
  return template.replace('</head>', `${hardening}</head>`);
}

async function nextHtmlVersionNumber(projectId) {
  const { data, error } = await supabase
    .from('document_html_versions')
    .select('version_number')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0]?.version_number ?? 0) + 1;
}

function enqueue(event) {
  const queue = readOfflineQueue();
  queue.push(compactQueuedEvent(event));
  writeOfflineQueue(queue);
}

function writeOfflineQueue(events) {
  const queue = events.slice(-MAX_QUEUE_EVENTS).map(compactQueuedEvent);
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
  return stripLargeLocalAssets({
    id: event.id,
    action: event.action,
    actor: event.actor,
    draft: event.draft || null,
    preview: event.preview || null,
    settings: event.settings || null,
    saveHtml: Boolean(event.saveHtml),
    createdAt: event.createdAt,
  });
}

function slugify(value) {
  return String(value || 'cliente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'cliente';
}

function stripLargeLocalAssets(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) {
      return `[imagem-local:${Math.round(value.length / 1024)}kb]`;
    }
    return value.length > 20000 ? `${value.slice(0, 20000)}...[conteudo-local-omitido]` : value;
  }
  if (Array.isArray(value)) return value.map(stripLargeLocalAssets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, stripLargeLocalAssets(item)]),
    );
  }
  return value;
}

function stableEnvironmentId(projectId, title, index) {
  const key = `${projectId}:${index}:${title || 'ambiente'}`;
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem(ENVIRONMENT_ID_KEY) || '{}');
  } catch {
    map = {};
  }
  if (!map[key]) {
    map[key] = crypto.randomUUID();
    localStorage.setItem(ENVIRONMENT_ID_KEY, JSON.stringify(map));
  }
  return map[key];
}

if (typeof window !== 'undefined' && isSupabaseConfigured && navigator?.onLine) {
  flushOfflineQueue().catch((error) => console.warn('Falha ao limpar fila offline na inicialização:', error));
  window.addEventListener('online', () => flushOfflineQueue().catch((error) => console.warn('Falha ao reenviar fila offline após reconexão:', error)));
}
