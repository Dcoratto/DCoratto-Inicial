import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const localEnvKeys = new Set();
loadLocalEnvFile('.env');
loadLocalEnvFile('.env.local', true);

const port = Number(process.env.PORT || 4173);
const root = resolve('dist');
const publicRoot = resolve('public');
const indexFile = join(root, 'index.html');
const htmlBucket = process.env.SUPABASE_HTML_BUCKET || process.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const primaryAccountEmail = 'dcorattoinovacao@gmail.com';
const localLoginUsers = [
  { email: primaryAccountEmail, password: 'sob_medida', name: "D'Coratto Inovacao", role: 'owner' },
  { email: 'rafael@dcoratto.com.br', password: 'Dcoratto@Rafael26', name: 'Rafael', role: 'team' },
  { email: 'isabela@dcoratto.com.br', password: 'Dcoratto@Isabela26', name: 'Isabela', role: 'team' },
  { email: 'vinicius@dcoratto.com.br', password: 'Dcoratto@Vinicius26', name: 'Vinicius', role: 'team' },
];
const supabaseServer = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

function loadLocalEnvFile(fileName, overrideLocal = false) {
  const filePath = resolve(fileName);
  if (!existsSync(filePath)) return;
  let content = '';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    console.warn(`Nao foi possivel carregar ${fileName}.`, error);
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined && !(overrideLocal && localEnvKeys.has(key))) continue;
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, '\n');
    localEnvKeys.add(key);
  }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'POST' && url.pathname === '/api/login') {
    await handleLoginRequest(request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/client-links') {
    await handleClientLinkRequest(request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/editor-events') {
    await handleEditorEventRequest(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/editor-state/latest') {
    await handleLatestEditorStateRequest(url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/editor-settings') {
    await handleEditorSettingsGet(response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/editor-settings') {
    await handleEditorSettingsPost(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/client-history') {
    await handleClientHistoryRequest(response);
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/cliente/')) {
    await handleClientHtmlRequest(url, response);
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(join(root, safePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    filePath = indexFile;
  }

  if (!existsSync(filePath)) {
    response.writeHead(404);
    response.end('Build not found. Run npm run build first.');
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`D'coratto editor listening on port ${port}`);
});

async function handleLoginRequest(request, response) {
  try {
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password) {
      sendJson(response, 400, { error: 'Informe email e senha.' });
      return;
    }

    if (supabaseServer) {
      try {
        const { data, error } = await supabaseServer.rpc('verify_app_login', {
          login_email: email,
          login_password: password,
        });
        if (!error && data?.ok && data?.user?.email) {
          sendJson(response, 200, { ok: true, source: 'supabase', user: normalizeAppUser(data.user) });
          return;
        }
      } catch (error) {
        console.warn('Login por Supabase indisponivel; usando fallback local.', error);
      }
    }

    const fallbackUser = localLoginUsers.find((user) => user.email === email && user.password === password);
    if (!fallbackUser) {
      sendJson(response, 401, { error: 'Credenciais incorretas.' });
      return;
    }

    sendJson(response, 200, { ok: true, source: 'local', user: normalizeAppUser(fallbackUser) });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
}

async function handleClientLinkRequest(request, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para gerar links persistentes.',
      });
      return;
    }

    const body = await readJsonBody(request);
    const preview = body.preview || {};
    const projectId = safeId(body.projectId) || crypto.randomUUID();
    if (!Array.isArray(preview.environments) || !preview.environments.length) {
      sendJson(response, 400, { error: 'Adicione ao menos um ambiente antes de gerar o link do cliente.' });
      return;
    }

    await ensureHtmlBucket();
    const versionNumber = await nextHtmlVersionNumber(projectId);
    const shareSlug = `${slugify(preview.client?.name || 'cliente')}-${String(versionNumber).padStart(3, '0')}-${crypto.randomUUID().slice(0, 8)}`;
    const storagePath = `${projectId}/cliente/${shareSlug}.html`;
    const html = await buildStandaloneHtml(preview);
    const clientUrl = `${requestOrigin(request)}/cliente/${encodeURIComponent(projectId)}/${encodeURIComponent(shareSlug)}`;

    const { error: uploadError } = await supabaseServer.storage
      .from(htmlBucket)
      .upload(storagePath, new Blob([html], { type: 'text/html;charset=utf-8' }), {
        cacheControl: '60',
        contentType: 'text/html;charset=utf-8',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabaseServer.storage.from(htmlBucket).getPublicUrl(storagePath);
    const storagePublicUrl = publicData?.publicUrl || '';
    const dbResult = await persistHtmlVersion({
      projectId,
      versionNumber,
      shareSlug,
      storagePath,
      publicUrl: clientUrl,
      storagePublicUrl,
      html,
      preview,
      actor: body.actor,
      draft: body.draft,
      eventId: body.eventId,
      createdAt: body.createdAt,
    });

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId,
      publicUrl: clientUrl,
      storagePublicUrl,
      storagePath,
      shareSlug,
      dbWarning: dbResult.warning || '',
    });
  } catch (error) {
    sendJson(response, 500, {
      error: String(error?.message || error),
    });
  }
}

async function handleEditorEventRequest(request, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para persistir o editor.',
      });
      return;
    }

    const body = await readJsonBody(request);
    const projectId = safeId(body.projectId) || crypto.randomUUID();
    await persistEditorState({
      projectId,
      actor: body.actor,
      action: body.action,
      draft: body.draft,
      preview: body.preview,
      settings: body.settings,
      eventId: body.eventId,
      createdAt: body.createdAt,
    });

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: String(error?.message || error),
    });
  }
}

async function handleLatestEditorStateRequest(url, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para carregar o rascunho.',
      });
      return;
    }

    const requestedProjectId = safeId(url.searchParams.get('projectId'));
    const actorEmail = normalizeEmail(url.searchParams.get('actor'));
    let project = null;
    if (requestedProjectId) {
      const { data, error } = await supabaseServer
        .from('document_projects')
        .select('id, data, updated_at')
        .eq('id', requestedProjectId)
        .maybeSingle();
      if (error) throw error;
      project = data || null;
    } else {
      const { data: projects, error: projectError } = await supabaseServer
        .from('document_projects')
        .select('id, data, updated_at')
        .eq('document_type', 'projeto_inicial')
        .eq('updated_by', actorEmail || primaryAccountEmail)
        .order('updated_at', { ascending: false })
        .limit(12);
      if (projectError) throw projectError;
      project = (projects || []).find(item => hasPersistableContent(item?.data?.draft, item?.data?.preview)) || null;
    }

    let settings = null;
    try {
      settings = await loadSharedEditorSettings();
    } catch (settingsError) {
      console.warn('Nao foi possivel carregar configuracoes remotas.', settingsError);
    }

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId: project?.id || null,
      updatedAt: project?.updated_at || null,
      draft: project?.data?.draft || null,
      preview: project?.data?.preview || null,
      settings,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: String(error?.message || error),
    });
  }
}

async function handleEditorSettingsGet(response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para carregar configuracoes.',
      });
      return;
    }

    const settings = await loadSharedEditorSettings();
    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      settings,
    });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
}

async function handleEditorSettingsPost(request, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para salvar configuracoes.',
      });
      return;
    }

    const body = await readJsonBody(request);
    const settings = await saveSharedEditorSettings(body.settings || {}, body.actor || null);
    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      settings,
    });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
}

async function handleClientHistoryRequest(response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para carregar histórico de clientes.',
      });
      return;
    }

    const { data: versions, error } = await supabaseServer
      .from('document_html_versions')
      .select('id, title, share_slug, project_id, created_at, created_by, data, is_current, replacement_public_url')
      .eq('shared_with_client', true)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;

    const history = (versions || []).map((v) => {
      const designerEmail = normalizeEmail(v.created_by || v.data?.createdBy || v.data?.actor?.email);
      return {
        id: v.id,
        title: v.title,
        clientName: v.data?.client?.name || 'Cliente',
        contractNumber: v.data?.client?.contractNumber || '',
        address: v.data?.client?.address || '',
        designerEmail,
        designerName: designerNameFromEmail(designerEmail),
        shareSlug: v.share_slug,
        projectId: v.project_id,
        createdAt: v.created_at,
        publicUrl: v.data?.publicUrl || '',
        isCurrent: v.is_current !== false,
        replacementPublicUrl: v.replacement_public_url || '',
      };
    });

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      history,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: String(error?.message || error),
    });
  }
}

async function handleClientHtmlRequest(url, response) {
  try {
    if (!supabaseServer) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Servidor sem SUPABASE_SERVICE_ROLE_KEY para carregar o HTML do cliente.');
      return;
    }

    const clientLink = parseClientLink(url.pathname);
    if (!clientLink.shareSlug) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Link do cliente nao encontrado.');
      return;
    }

    const html = await loadClientHtml(clientLink);

    if (!html) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('HTML do cliente nao encontrado.');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(html);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Nao foi possivel abrir o HTML do cliente: ${String(error?.message || error)}`);
  }
}

function parseClientLink(pathname) {
  const parts = pathname
    .replace(/^\/cliente\/?/, '')
    .split('/')
    .map(part => decodeURIComponent(part).trim())
    .filter(Boolean);
  if (parts.length >= 2 && safeId(parts[0])) {
    return { projectId: parts[0], shareSlug: parts[1] };
  }
  return { projectId: '', shareSlug: parts[0] || '' };
}

async function loadClientHtml({ projectId, shareSlug }) {
  if (projectId) {
    const storagePath = `${projectId}/cliente/${shareSlug}.html`;
    const byStoragePath = await findHtmlVersionByStoragePath(storagePath);
    if (byStoragePath) return byStoragePath;

    const downloaded = await downloadHtmlFromStorage(storagePath);
    if (downloaded) return downloaded;
  }

  const byShareSlug = await findHtmlVersionByShareSlug(shareSlug);
  if (byShareSlug) return byShareSlug;

  const byDataShareSlug = await findHtmlVersionByDataShareSlug(shareSlug);
  if (byDataShareSlug) return byDataShareSlug;

  return '';
}

async function findHtmlVersionByStoragePath(storagePath) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('id, project_id, html_content, is_current, replacement_public_url, data')
    .eq('storage_path', storagePath)
    .eq('shared_with_client', true)
    .maybeSingle();
  if (error) throw error;
  return resolveHtmlVersion(data);
}

async function findHtmlVersionByShareSlug(shareSlug) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('id, project_id, html_content, is_current, replacement_public_url, data')
    .eq('share_slug', shareSlug)
    .eq('shared_with_client', true)
    .maybeSingle();
  if (error) throw error;
  return resolveHtmlVersion(data);
}

async function findHtmlVersionByDataShareSlug(shareSlug) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('id, project_id, html_content, is_current, replacement_public_url, data')
    .filter('data->>shareSlug', 'eq', shareSlug)
    .eq('shared_with_client', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    console.warn('Nao foi possivel buscar HTML por data.shareSlug.', error);
    return '';
  }
  return resolveHtmlVersion(data?.[0] || null);
}

async function resolveHtmlVersion(version) {
  if (!version) return '';
  if (version.is_current !== false) return version.html_content || '';
  const replacementUrl = version.replacement_public_url
    || version.data?.replacementPublicUrl
    || await currentProjectPublicUrl(version.project_id);
  return obsoleteClientLinkHtml(replacementUrl);
}

async function currentProjectPublicUrl(projectId) {
  if (!projectId) return '';
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('data, replacement_public_url')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .eq('shared_with_client', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return '';
  return data?.[0]?.data?.publicUrl || data?.[0]?.replacement_public_url || '';
}

function obsoleteClientLinkHtml(replacementUrl = '') {
  const safeUrl = escapeHtml(replacementUrl);
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Link atualizado | D'Coratto</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080807;color:#f7f2ea;font-family:Arial,sans-serif;padding:24px}
      main{max-width:560px;text-align:center;border:1px solid rgba(184,151,106,.28);background:#15120f;padding:34px}
      h1{margin:0 0 12px;color:#d7c2a7;font-family:Georgia,serif;font-weight:400}
      p{line-height:1.55;color:#d8c8b3}
      a{display:inline-block;margin-top:14px;color:#080807;background:#d7c2a7;padding:12px 16px;text-decoration:none;font-weight:700}
    </style>
  </head>
  <body>
    <main>
      <h1>há um novo link desse projeto</h1>
      <p>Este link foi substituído por uma versão mais recente do projeto.</p>
      ${safeUrl ? `<a href="${safeUrl}">Abrir novo link</a>` : ''}
    </main>
  </body>
</html>`;
}

async function downloadHtmlFromStorage(storagePath) {
  const { data, error } = await supabaseServer.storage
    .from(htmlBucket)
    .download(storagePath);
  if (error) return '';
  return data?.text ? data.text() : '';
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 50_000_000) throw new Error('O projeto ficou grande demais para persistir. Reduza imagens muito pesadas.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function ensureHtmlBucket() {
  const { data: buckets, error: listError } = await supabaseServer.storage.listBuckets();
  if (listError) throw listError;
  if (buckets?.some((bucket) => bucket.name === htmlBucket || bucket.id === htmlBucket)) {
    if (typeof supabaseServer.storage.updateBucket === 'function') {
      await supabaseServer.storage.updateBucket(htmlBucket, {
        public: true,
        fileSizeLimit: 52_428_800,
        allowedMimeTypes: ['text/html'],
      }).catch((error) => console.warn('Nao foi possivel atualizar o bucket HTML.', error));
    }
    return;
  }

  const { error } = await supabaseServer.storage.createBucket(htmlBucket, {
    public: true,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: ['text/html'],
  });
  if (error) throw error;
}

async function persistEditorState({ projectId, actor, action, draft, preview, settings, eventId, createdAt }) {
  if (settings) {
    await saveSharedEditorSettings(settings, actor);
  }

  if (!hasPersistableContent(draft, preview)) return;

  const client = preview?.client || {};
  const actorEmail = normalizeEmail(actor?.email);
  const projectPayload = {
    id: projectId,
    title: preview?.projectType || 'Projeto Inicial',
    client_name: client.name || draft?.fields?.clientName || '',
    contract_number: client.contractNumber || draft?.fields?.contractNum || '',
    factory: Array.isArray(client.manufacturers) ? client.manufacturers.join(' + ') : '',
    address: client.address || draft?.fields?.endereco || '',
    document_type: 'projeto_inicial',
    status: 'draft',
    owner_email: primaryAccountEmail,
    created_by: actorEmail,
    updated_by: actorEmail,
    data: {
      draft: draft || null,
      preview: preview || null,
      actor: actor || null,
      ownerEmail: primaryAccountEmail,
      lastAction: action || 'autosave',
      lastEventId: eventId || null,
      lastEventAt: createdAt || new Date().toISOString(),
    },
  };

  const { error } = await supabaseServer
    .from('document_projects')
    .upsert(projectPayload, { onConflict: 'id' });
  if (error) throw error;
}

async function loadSharedEditorSettings() {
  const { data, error } = await supabaseServer
    .from('editor_settings')
    .select('payload')
    .eq('settings_key', 'default')
    .maybeSingle();
  if (error) throw error;
  const tableSettings = await loadSettingsFromSharedCatalogTables();
  const storedPayload = data?.payload || {};
  const payload = normalizeEditorSettingsPayload(storedPayload);
  const hasPayloadCatalog = Array.isArray(storedPayload.catalogItems);
  const hasPayloadOptions = storedPayload.materialOptions && typeof storedPayload.materialOptions === 'object';
  return {
    ...payload,
    catalogItems: hasPayloadCatalog ? payload.catalogItems : tableSettings.catalogItems,
    materialOptions: hasPayloadOptions ? payload.materialOptions : tableSettings.materialOptions,
  };
}

async function saveSharedEditorSettings(incomingSettings, actor = null) {
  const currentSettings = await loadSharedEditorSettings();
  const actorEmail = normalizeEmail(actor?.email);
  const canUpdateSharedCatalog = !actorEmail || actorEmail === primaryAccountEmail;
  const payload = canUpdateSharedCatalog
    ? normalizeEditorSettingsPayload(incomingSettings)
    : (currentSettings || mergeEditorSettingsPayload(currentSettings, {}));
  const { error } = await supabaseServer
    .from('editor_settings')
    .upsert({
      settings_key: 'default',
      payload,
      updated_by: actorEmail || '',
    }, { onConflict: 'settings_key' });
  if (error) throw error;
  if (canUpdateSharedCatalog) {
    await persistSharedCatalogTables(payload, actorEmail).catch((tableError) => {
      console.warn('Configuracoes salvas, mas nao foi possivel espelhar catalogos nas tabelas.', tableError);
    });
  }
  return payload;
}

function normalizeEditorSettingsPayload(settings = {}) {
  const incomingSettings = settings || {};
  return {
    ...incomingSettings,
    logo: incomingSettings.logo || '',
    catalogItems: normalizeCatalogItemsPayload(incomingSettings.catalogItems),
    observations: Array.isArray(incomingSettings.observations)
      ? [...new Set(incomingSettings.observations.filter(value => String(value || '').trim()))]
      : [],
    materialOptions: normalizeMaterialOptionsPayload(incomingSettings.materialOptions),
  };
}

function mergeEditorSettingsPayload(current = {}, incoming = {}) {
  const currentSettings = current || {};
  const incomingSettings = incoming || {};
  return {
    ...currentSettings,
    ...incomingSettings,
    logo: incomingSettings.logo || currentSettings.logo || '',
    catalogItems: mergeCatalogItemsPayload(currentSettings.catalogItems, incomingSettings.catalogItems),
    observations: [...new Set([...(currentSettings.observations || []), ...(incomingSettings.observations || [])])],
    materialOptions: mergeMaterialOptionsPayload(currentSettings.materialOptions, incomingSettings.materialOptions),
  };
}

function catalogItemTextureUrlPayload(item = {}) {
  return item.textureUrl
    || item.imageUrl
    || item.imageData
    || item.texture_url
    || item.image_url
    || item.image_data
    || item.data?.textureUrl
    || item.data?.imageUrl
    || item.data?.image
    || '';
}

function normalizeCatalogItemsPayload(items = []) {
  const merged = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || !item.name) return;
    const textureUrl = catalogItemTextureUrlPayload(item);
    const normalizedItem = textureUrl && item.textureUrl !== textureUrl ? { ...item, textureUrl } : { ...item };
    const key = [
      normalizedItem.id,
      normalizedItem.type,
      normalizedItem.manufacturer,
      normalizedItem.line,
      normalizedItem.name,
      normalizedItem.quality,
      textureUrl || normalizedItem.hex || '',
    ].filter(Boolean).join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalizedItem);
  });
  return preferAdminCatalogItems(merged);
}

function preferAdminCatalogItems(items = []) {
  const adminManagedTypes = new Set(items
    .filter(item => ['manual', 'admin', 'upload'].includes(String(item.source || '').toLowerCase()))
    .map(item => item.type));
  if (!adminManagedTypes.size) return items;
  return items.filter(item => !adminManagedTypes.has(item.type) || String(item.source || '').toLowerCase() !== 'shared');
}

function mergeCatalogItemsPayload(current = [], incoming = []) {
  const merged = [];
  const seen = new Set();
  [...normalizeCatalogItemsPayload(current), ...normalizeCatalogItemsPayload(incoming)].forEach((item) => {
    if (!item || !item.name) return;
    const textureUrl = catalogItemTextureUrlPayload(item);
    const key = [
      item.id,
      item.type,
      item.manufacturer,
      item.line,
      item.name,
      item.quality,
      textureUrl || item.hex || '',
    ].filter(Boolean).join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function normalizeMaterialOptionsPayload(options = {}) {
  const groups = new Set(['tampon', 'porta', 'puxador', 'corredica', ...Object.keys(options || {})]);
  return Object.fromEntries([...groups].map(group => [
    group,
    Array.isArray(options?.[group])
      ? [...new Set(options[group].filter(value => String(value || '').trim()))]
      : [],
  ]));
}

function mergeMaterialOptionsPayload(current = {}, incoming = {}) {
  const groups = new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})]);
  return Object.fromEntries([...groups].map(group => [
    group,
    [...new Set([...(current?.[group] || []), ...(incoming?.[group] || [])])],
  ]));
}

async function loadSettingsFromSharedCatalogTables() {
  const [materialsResult, optionsResult] = await Promise.all([
    supabaseServer
      .from('catalog_materials')
      .select('group_key, name, manufacturer, line_name, quality, hex, texture_url, image_url, image_data, sort_order, data')
      .eq('active', true)
      .eq('owner_email', primaryAccountEmail)
      .order('sort_order', { ascending: true }),
    supabaseServer
      .from('catalog_options')
      .select('group_key, label, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
  ]);

  if (materialsResult.error) throw materialsResult.error;
  if (optionsResult.error) throw optionsResult.error;

  const catalogItems = (materialsResult.data || [])
    .map(catalogMaterialToSettingsItem)
    .filter(Boolean);
  const materialOptions = (optionsResult.data || []).reduce((acc, option) => {
    if (!option?.group_key || !option?.label) return acc;
    acc[option.group_key] = [...(acc[option.group_key] || []), option.label];
    return acc;
  }, {});

  return { catalogItems, materialOptions };
}

function catalogMaterialToSettingsItem(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {};
  const type = data.type || settingsTypeFromCatalogGroup(row?.group_key);
  if (!type || !row?.name) return null;
  const textureUrl = data.textureUrl || data.imageUrl || row.image_data || row.image_url || row.texture_url || '';
  return {
    id: data.id || `${row.group_key}-${row.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    type,
    manufacturer: data.manufacturer || row.manufacturer || '',
    line: data.line || data.line_name || row.line_name || '',
    name: data.name || row.name,
    quality: data.quality || row.quality || '',
    hex: data.hex || row.hex || '#b8976a',
    textureUrl,
    source: data.source || 'shared',
  };
}

function settingsTypeFromCatalogGroup(groupKey) {
  return {
    color: 'color',
    boa_vista_cores: 'color',
    madeira: 'color',
    laca: 'color',
    puxador: 'handle',
    porta: 'door',
    corredica: 'slide',
  }[groupKey] || '';
}

async function persistSharedCatalogTables(settings = {}, actorEmail = '') {
  const catalogItems = Array.isArray(settings.catalogItems) ? settings.catalogItems : [];
  const materialOptions = settings.materialOptions || {};
  const catalogGroups = [...new Set(['color', 'puxador', 'porta', 'corredica', ...catalogItems.map(item => catalogItemGroup(item.type)).filter(Boolean)])];
  const optionGroups = [...new Set(['tampon', 'porta', 'puxador', 'corredica', ...Object.keys(materialOptions || {})])];

  const materialRows = catalogItems
    .filter(item => item?.name)
    .map((item, index) => ({
      group_key: catalogItemGroup(item.type),
      name: item.name,
      code: item.id || null,
      brand: item.brand || item.manufacturer || null,
      manufacturer: item.manufacturer || null,
      line_name: item.line || item.line_name || null,
      quality: item.quality || null,
      hex: item.hex || null,
      texture_url: item.textureUrl || item.imageUrl || null,
      image_data: String(item.textureUrl || '').startsWith('data:image/') ? item.textureUrl : null,
      image_url: String(item.textureUrl || item.imageUrl || '').startsWith('http') || String(item.textureUrl || item.imageUrl || '').startsWith('/')
        ? (item.textureUrl || item.imageUrl)
        : null,
      sort_order: index,
      active: true,
      owner_email: primaryAccountEmail,
      updated_by: actorEmail || primaryAccountEmail,
      data: item,
    }));

  if (catalogGroups.length) {
    const { error } = await supabaseServer
      .from('catalog_materials')
      .update({
        active: false,
        updated_by: actorEmail || primaryAccountEmail,
      })
      .eq('owner_email', primaryAccountEmail)
      .in('group_key', catalogGroups);
    if (error) throw error;
  }

  if (materialRows.length) {
    const { error } = await supabaseServer
      .from('catalog_materials')
      .upsert(materialRows, { onConflict: 'group_key,name' });
    if (error) throw error;
  }

  const imageByOption = new Map();
  catalogItems.forEach((item) => {
    const group = catalogItemOptionGroup(item.type);
    if (!group || !item?.name) return;
    const label = `${item.name}${item.line ? ' · ' + item.line : ''}`;
    imageByOption.set(`${group}|${label}`.toLowerCase(), item.textureUrl || item.imageUrl || '');
  });

  const optionRows = Object.entries(materialOptions).flatMap(([group, options]) => {
    if (!Array.isArray(options)) return [];
    return options.filter(Boolean).map((label, index) => {
      const image = imageByOption.get(`${group}|${label}`.toLowerCase()) || '';
      return {
        group_key: group,
        label,
        sort_order: index,
        active: true,
        image_data: String(image).startsWith('data:image/') ? image : null,
        image_url: String(image).startsWith('http') || String(image).startsWith('/') ? image : null,
        updated_by: actorEmail || primaryAccountEmail,
        data: image ? { image } : {},
      };
    });
  });

  if (optionGroups.length) {
    const { error } = await supabaseServer
      .from('catalog_options')
      .update({
        active: false,
        updated_by: actorEmail || primaryAccountEmail,
      })
      .eq('owner_email', primaryAccountEmail)
      .in('group_key', optionGroups);
    if (error) throw error;
  }

  if (optionRows.length) {
    const { error } = await supabaseServer
      .from('catalog_options')
      .upsert(optionRows, { onConflict: 'group_key,label' });
    if (error) throw error;
  }
}

function catalogItemGroup(type) {
  return {
    color: 'color',
    handle: 'puxador',
    door: 'porta',
    slide: 'corredica',
  }[type] || String(type || 'material');
}

function catalogItemOptionGroup(type) {
  return {
    handle: 'puxador',
    door: 'porta',
    slide: 'corredica',
  }[type] || '';
}

function hasPersistableContent(draft, preview) {
  const hasPreviewContent = Array.isArray(preview?.environments) && preview.environments.length > 0;
  const hasAmbientes = Array.isArray(draft?.ambientes) && draft.ambientes.length > 0;
  const hasFields = Object.values(draft?.fields || {}).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(String(value || '').trim());
  });
  return hasPreviewContent || hasAmbientes || hasFields;
}

async function persistHtmlVersion({ projectId, versionNumber, shareSlug, storagePath, publicUrl, storagePublicUrl, html, preview, actor, draft, eventId, createdAt }) {
  try {
    const client = preview.client || {};
    const actorEmail = normalizeEmail(actor?.email);
    const { error: projectError } = await supabaseServer
      .from('document_projects')
      .upsert({
        id: projectId,
        title: preview.projectType || 'Projeto Inicial',
        client_name: client.name || draft?.fields?.clientName || '',
        contract_number: client.contractNumber || draft?.fields?.contractNum || '',
        factory: Array.isArray(client.manufacturers) ? client.manufacturers.join(' + ') : '',
        address: client.address || draft?.fields?.endereco || '',
        document_type: 'projeto_inicial',
        status: 'draft',
        owner_email: primaryAccountEmail,
        created_by: actorEmail,
        updated_by: actorEmail,
        data: { draft: draft || null, preview, actor: actor || null, ownerEmail: primaryAccountEmail, lastEventId: eventId || null, lastEventAt: createdAt || new Date().toISOString() },
      });
    if (projectError) throw projectError;

    const htmlPayload = {
      project_id: projectId,
      version_number: versionNumber,
      title: `Projeto Inicial - ${client.name || 'Cliente'}`,
      html_content: html,
      storage_bucket: htmlBucket,
      storage_path: storagePath,
      is_current: true,
      shared_with_client: true,
      shared_at: new Date().toISOString(),
      created_by: actorEmail,
      owner_email: primaryAccountEmail,
      share_slug: shareSlug,
      data: {
        publicUrl,
        storagePublicUrl,
        client,
        shareSlug,
        sharedWithClient: true,
        sharedAt: new Date().toISOString(),
        createdBy: actorEmail,
        ownerEmail: primaryAccountEmail,
      },
    };

    const { data: insertedVersion, error: htmlError } = await supabaseServer
      .from('document_html_versions')
      .insert(htmlPayload)
      .select('id')
      .single();
    if (htmlError) throw htmlError;

    if (insertedVersion?.id) {
      await supabaseServer
        .from('document_html_versions')
        .update({
          is_current: false,
          superseded_at: new Date().toISOString(),
          superseded_by_id: insertedVersion.id,
          replacement_public_url: publicUrl,
        })
        .eq('project_id', projectId)
        .neq('id', insertedVersion.id)
        .eq('shared_with_client', true);

      await supabaseServer
        .from('document_projects')
        .update({ current_html_id: insertedVersion.id })
        .eq('id', projectId);
    }

    return {};
  } catch (error) {
    console.warn('Link salvo no Storage, mas nao foi possivel registrar a versao no banco.', error);
    return { warning: String(error?.message || error) };
  }
}

async function nextHtmlVersionNumber(projectId) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('version_number')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('Nao foi possivel consultar versoes HTML. Usando versao 1.', error);
    return 1;
  }
  return (data?.[0]?.version_number ?? 0) + 1;
}

async function buildStandaloneHtml(preview) {
  const distTemplate = join(root, 'portfolio_document.html');
  const publicTemplate = join(publicRoot, 'portfolio_document.html');
  const templatePath = existsSync(distTemplate) ? distTemplate : publicTemplate;
  const template = await readFile(templatePath, 'utf8');
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

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAppUser(user = {}) {
  const email = normalizeEmail(user.email);
  return {
    email,
    name: user.name || user.display_name || email,
    role: user.role || (email === primaryAccountEmail ? 'owner' : 'team'),
    primaryAccountEmail,
    isPrimary: email === primaryAccountEmail,
  };
}

function designerNameFromEmail(email = '') {
  const normalizedEmail = normalizeEmail(email);
  const knownUser = localLoginUsers.find(user => user.email === normalizedEmail);
  return knownUser?.name || normalizedEmail || 'Não informado';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function requestOrigin(request) {
  const host = request.headers['x-forwarded-host'] || request.headers.host || `localhost:${port}`;
  const proto = request.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
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

function safeId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
    ? String(value)
    : '';
}
