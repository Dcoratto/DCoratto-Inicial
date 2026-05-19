import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const port = Number(process.env.PORT || 4173);
const root = resolve('dist');
const publicRoot = resolve('public');
const indexFile = join(root, 'index.html');
const htmlBucket = process.env.SUPABASE_HTML_BUCKET || process.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseServer = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

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

    const { data: projects, error: projectError } = await supabaseServer
      .from('document_projects')
      .select('id, data, updated_at')
      .eq('document_type', 'projeto_inicial')
      .order('updated_at', { ascending: false })
      .limit(12);
    if (projectError) throw projectError;
    const project = (projects || []).find(item => hasPersistableContent(item?.data?.draft, item?.data?.preview)) || null;

    const { data: settingsRow, error: settingsError } = await supabaseServer
      .from('editor_settings')
      .select('payload')
      .eq('settings_key', 'default')
      .maybeSingle();
    if (settingsError) console.warn('Nao foi possivel carregar configuracoes remotas.', settingsError);

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId: project?.id || null,
      updatedAt: project?.updated_at || null,
      draft: project?.data?.draft || null,
      preview: project?.data?.preview || null,
      settings: settingsRow?.payload || null,
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
    .select('html_content')
    .eq('storage_path', storagePath)
    .eq('shared_with_client', true)
    .maybeSingle();
  if (error) throw error;
  return data?.html_content || '';
}

async function findHtmlVersionByShareSlug(shareSlug) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('html_content')
    .eq('share_slug', shareSlug)
    .eq('shared_with_client', true)
    .maybeSingle();
  if (error) throw error;
  return data?.html_content || '';
}

async function findHtmlVersionByDataShareSlug(shareSlug) {
  const { data, error } = await supabaseServer
    .from('document_html_versions')
    .select('html_content')
    .filter('data->>shareSlug', 'eq', shareSlug)
    .eq('shared_with_client', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    console.warn('Nao foi possivel buscar HTML por data.shareSlug.', error);
    return '';
  }
  return data?.[0]?.html_content || '';
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
    const { error } = await supabaseServer
      .from('editor_settings')
      .upsert({
        settings_key: 'default',
        payload: settings,
        updated_by: actor?.email || '',
      }, { onConflict: 'settings_key' });
    if (error) throw error;
  }

  if (!hasPersistableContent(draft, preview)) return;

  const client = preview?.client || {};
  const projectPayload = {
    id: projectId,
    title: preview?.projectType || 'Projeto Inicial',
    client_name: client.name || draft?.fields?.clientName || '',
    contract_number: client.contractNumber || draft?.fields?.contractNum || '',
    factory: Array.isArray(client.manufacturers) ? client.manufacturers.join(' + ') : '',
    address: client.address || draft?.fields?.endereco || '',
    document_type: 'projeto_inicial',
    status: 'draft',
    data: {
      draft: draft || null,
      preview: preview || null,
      actor: actor || null,
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
        data: { draft: draft || null, preview, actor: actor || null, lastEventId: eventId || null, lastEventAt: createdAt || new Date().toISOString() },
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
      created_by: actor?.email || '',
      share_slug: shareSlug,
      data: {
        publicUrl,
        storagePublicUrl,
        client,
        shareSlug,
        sharedWithClient: true,
        sharedAt: new Date().toISOString(),
        createdBy: actor?.email || '',
      },
    };

    const { error: htmlError } = await supabaseServer
      .from('document_html_versions')
      .insert(htmlPayload);
    if (htmlError) throw htmlError;

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
