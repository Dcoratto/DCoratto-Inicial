import { isSupabaseConfigured, supabase } from './supabaseClient';

const PROJECT_ID_KEY = 'dcoratto.active.project.id.v1';
const OFFLINE_QUEUE_KEY = 'dcoratto.persistence.queue.v1';
const ENVIRONMENT_ID_KEY = 'dcoratto.environment.ids.v1';
const HTML_BUCKET = import.meta.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';
const MAX_QUEUE_EVENTS = 25;
const MAX_QUEUE_BYTES = 1_200_000;
let warnedMissingSession = false;

export function getActiveProjectId() {
  const existing = localStorage.getItem(PROJECT_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(PROJECT_ID_KEY, id);
  return id;
}

export function readOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export async function persistEditorEvent({ action, actor, draft, preview, settings, saveHtml = false }) {
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
    data: {
      actor: event.actor,
      lastAction: event.action,
      lastEventId: event.id,
      lastEventAt: event.createdAt,
      draft,
      preview,
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
    await saveSharedHtml(projectId, preview, event.actor);
  }

  return { source: 'supabase', projectId };
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
  const storagePath = `${projectId}/cliente/projeto-inicial-v${String(versionNumber).padStart(3, '0')}.html`;
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
  const serialized = JSON.stringify(JSON.stringify(preview));
  const bootstrap = `<script>localStorage.setItem('dcoratto.portfolio.document.v1', ${serialized});</script>`;
  return template.replace('</head>', `${bootstrap}</head>`);
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
