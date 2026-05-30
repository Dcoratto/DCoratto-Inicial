import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const localEnvKeys = new Set();
loadLocalEnvFile('.env');
loadLocalEnvFile('.env.local', true);

const port = Number(process.env.PORT || 4173);
const root = resolve('dist');
const publicRoot = resolve('public');
const indexFile = join(root, 'index.html');
const htmlBucket = process.env.SUPABASE_HTML_BUCKET || process.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';
const photoBucket = process.env.SUPABASE_PHOTOS_BUCKET || process.env.VITE_SUPABASE_PHOTOS_BUCKET || 'dcoratto-photos';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SERVICE_ROLE_KEY
  || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  || '';
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

  if (request.method === 'GET' && url.pathname === '/api/catalog-materials') {
    await handleCatalogMaterialsGet(url, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/editor-settings') {
    await handleEditorSettingsPost(request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/project-status') {
    await handleProjectStatusRequest(request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/client-history') {
    await handleClientHistoryRequest(url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/projects') {
    await handleProjectsRequest(url, response);
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
    const projectId = safeId(body.projectId) || crypto.randomUUID();
    const actorEmail = normalizeEmail(body.actor?.email);
    const existingProject = await loadProjectForWrite(projectId);
    if (existingProject && !canAccessPrivateProject(existingProject, actorEmail)) {
      sendJson(response, 403, { error: 'forbidden_project_access' });
      return;
    }
    const promotedDocument = await promoteDocumentImages({
      projectId,
      draft: body.draft || null,
      preview: body.preview || {},
    });
    const preview = promotedDocument.preview || {};
    if (!Array.isArray(preview.environments) || !preview.environments.length) {
      sendJson(response, 400, { error: 'Adicione ao menos um ambiente antes de gerar o link do cliente.' });
      return;
    }

    const versionNumber = await nextHtmlVersionNumber(projectId);
    const shareSlug = `${slugify(preview.client?.name || 'cliente')}-${String(versionNumber).padStart(3, '0')}-${crypto.randomUUID().slice(0, 8)}`;
    const storagePath = `${projectId}/cliente/${shareSlug}.html`;
    const html = await buildStandaloneHtml(preview);
    const clientUrl = `${requestOrigin(request)}/cliente/${encodeURIComponent(projectId)}/${encodeURIComponent(shareSlug)}`;

    const dbResult = await persistHtmlVersion({
      projectId,
      versionNumber,
      shareSlug,
      storagePath,
      publicUrl: clientUrl,
      storagePublicUrl: '',
      html,
      preview,
      actor: body.actor,
      draft: promotedDocument.draft,
      eventId: body.eventId,
      createdAt: body.createdAt,
    });
    const finalPublicUrl = dbResult.publicUrl || clientUrl;
    const finalStoragePath = dbResult.storagePath || storagePath;
    const storageResult = dbResult.deduped
      ? { publicUrl: dbResult.storagePublicUrl || '', warning: '' }
      : await uploadHtmlSnapshotToStorage(finalStoragePath, html);

    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      projectId,
      publicUrl: finalPublicUrl,
      storagePublicUrl: storageResult.publicUrl || '',
      storagePath: finalStoragePath,
      shareSlug: dbResult.shareSlug || shareSlug,
      storageWarning: storageResult.warning || '',
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
    const actorEmail = normalizeEmail(body.actor?.email);
    const existingProject = await loadProjectForWrite(projectId);
    if (existingProject && !canAccessPrivateProject(existingProject, actorEmail)) {
      sendJson(response, 403, { error: 'forbidden_project_access' });
      return;
    }
    const promotedDocument = await promoteDocumentImages({
      projectId,
      draft: body.draft || null,
      preview: body.preview || null,
    });
    await persistEditorState({
      projectId,
      actor: body.actor,
      action: body.action,
      draft: promotedDocument.draft,
      preview: promotedDocument.preview,
      settings: body.settings,
      settingsMutation: body.settingsMutation || null,
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
        .select('id, data, updated_at, status, owner_email, created_by, assigned_to_email, draft_owner_email, deleted_at, deleted_for_users')
        .eq('id', requestedProjectId)
        .maybeSingle();
      if (error) throw error;
      project = data || null;
      if (project && !canAccessPrivateProject(project, actorEmail)) {
        sendJson(response, 403, { error: 'forbidden_project_access' });
        return;
      }
    } else {
      let query = supabaseServer
        .from('document_projects')
        .select('id, data, updated_at, status, owner_email, created_by, assigned_to_email, draft_owner_email, deleted_at, deleted_for_users')
        .eq('document_type', 'projeto_inicial')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(24);
      if (!isAdminEmail(actorEmail)) {
        query = query.or(privateProjectAccessOr(actorEmail));
      }
      const { data: projects, error: projectError } = await query;
      if (projectError) throw projectError;
      project = (projects || [])
        .filter(item => !isDeletedForUser(item, actorEmail))
        .find(item => hasPersistableContent(item?.data?.draft, item?.data?.preview)) || null;
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
      status: project?.status || 'draft',
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

async function handleProjectStatusRequest(request, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para atualizar o status.',
      });
      return;
    }
    const body = await readJsonBody(request);
    const projectId = safeId(body.projectId);
    const status = String(body.status || '').trim();
    if (!projectId || !['draft', 'active', 'review', 'approved', 'archived', 'sold'].includes(status)) {
      sendJson(response, 400, { error: 'Status ou projeto invalido.' });
      return;
    }
    const current = await loadProjectForWrite(projectId);
    const actorEmail = normalizeEmail(body.actor?.email);
    if (current && !canAccessPrivateProject(current, actorEmail)) {
      sendJson(response, 403, { error: 'forbidden_project_access' });
      return;
    }
    const currentData = current?.data && typeof current.data === 'object' ? current.data : {};

    const { error } = await supabaseServer
      .from('document_projects')
      .update({
        status,
        updated_by: actorEmail,
        last_editor_email: actorEmail,
        last_editor_name: String(body.actor?.name || ''),
        sold_at: status === 'sold' ? new Date().toISOString() : null,
        sold_by: status === 'sold' ? actorEmail : null,
        locked_at: status === 'sold' ? new Date().toISOString() : null,
        locked_by: status === 'sold' ? actorEmail : null,
        lock_reason: status === 'sold' ? 'sold_project' : null,
        data: {
          ...currentData,
          soldAt: status === 'sold' ? new Date().toISOString() : null,
          soldBy: status === 'sold' ? actorEmail : null,
        },
      })
      .eq('id', projectId);
    if (error) throw error;
    sendJson(response, 200, { ok: true, projectId, status });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
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

async function handleCatalogMaterialsGet(url, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para carregar catalogos.',
      });
      return;
    }

    const filters = {
      category: String(url.searchParams.get('category') || '').trim(),
      factory: String(url.searchParams.get('factory') || '').trim(),
      line: String(url.searchParams.get('line') || '').trim(),
      quality: String(url.searchParams.get('quality') || '').trim(),
      search: String(url.searchParams.get('search') || '').trim(),
      limit: Math.min(500, Math.max(25, Number(url.searchParams.get('limit') || 250))),
    };

    let query = supabaseServer
      .from('catalog_materials')
      .select('id,catalog_key,group_key,name,code,manufacturer,line_name,quality,material_type,category,hex,texture_url,image_url,storage_bucket,storage_path,public_url,mime_type,width,height,active,sort_order,created_by,updated_by,created_at,updated_at,data')
      .eq('active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .limit(filters.limit);

    if (filters.category) query = query.eq('group_key', catalogItemGroup(filters.category));
    if (filters.factory) query = query.eq('manufacturer', filters.factory);
    if (filters.line) query = query.eq('line_name', filters.line);
    if (filters.quality) query = query.eq('quality', filters.quality);
    if (filters.search) {
      const term = escapePostgrestLike(filters.search);
      query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,catalog_key.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const tableItems = (data || []).map(catalogMaterialToSettingsItem).filter(Boolean);
    let items = tableItems;
    try {
      const settings = await loadSharedEditorSettings();
      const payloadItems = (settings.catalogItems || []).filter(item => catalogItemMatchesFiltersPayload(item, filters));
      items = mergeCatalogItemsPayload(tableItems, payloadItems).slice(0, filters.limit);
    } catch (settingsError) {
      console.warn('Catalogo filtrado carregado sem merge do payload de configuracoes.', settingsError);
    }
    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      filters,
      items,
    });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
}

function catalogItemMatchesFiltersPayload(item = {}, filters = {}) {
  if (!item?.name) return false;
  if (filters.category && catalogItemGroup(item.type || item.category) !== catalogItemGroup(filters.category)) return false;
  if (filters.factory && (item.manufacturer || item.factory || '') !== filters.factory) return false;
  if (filters.line && (item.line || item.lineName || item.line_name || '') !== filters.line) return false;
  if (filters.quality && (item.quality || item.materialType || '') !== filters.quality) return false;
  if (filters.search) {
    const term = normalizeCatalogSearch(filters.search);
    const haystack = normalizeCatalogSearch([
      item.name,
      item.code,
      item.id,
      item.catalogKey,
      item.catalog_key,
      item.manufacturer,
      item.line,
      item.quality,
    ].filter(Boolean).join(' '));
    if (!haystack.includes(term)) return false;
  }
  return true;
}

function normalizeCatalogSearch(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
    const settings = await saveSharedEditorSettings(body.settings || {}, body.actor || null, body.settingsMutation || null);
    sendJson(response, 200, {
      ok: true,
      source: 'server-supabase',
      settings,
    });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
}

async function handleClientHistoryRequest(url, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para carregar histórico de clientes.',
      });
      return;
    }

    const actorEmail = normalizeEmail(url.searchParams.get('actor'));
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true' && isAdminEmail(actorEmail);
    let query = supabaseServer
      .from('document_html_versions')
      .select('id, title, share_slug, project_id, created_at, created_by, assigned_to_email, data, is_current, replacement_public_url')
      .eq('shared_with_client', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!includeDeleted) query = query.is('deleted_at', null);
    if (!isAdminEmail(actorEmail)) {
      query = query.or(`created_by.eq.${escapePostgrestValue(actorEmail)},assigned_to_email.eq.${escapePostgrestValue(actorEmail)}`);
    }
    const { data: versions, error } = await query;
    
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

async function handleProjectsRequest(url, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para carregar projetos.',
      });
      return;
    }

    const actorEmail = normalizeEmail(url.searchParams.get('actor'));
    const folder = String(url.searchParams.get('folder') || 'active').trim();
    let query = supabaseServer
      .from('document_projects')
      .select('id, title, client_name, contract_number, address, status, is_draft, draft_saved_at, updated_at, created_by, assigned_to_email, last_editor_name, last_editor_email, deleted_at, deleted_by, deleted_reason, deleted_for_users')
      .eq('document_type', 'projeto_inicial')
      .order('updated_at', { ascending: false })
      .limit(100);
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true' && isAdminEmail(actorEmail);
    if (!includeDeleted) query = query.is('deleted_at', null);

    if (folder === 'drafts') {
      query = query.eq('is_draft', true);
    } else if (folder === 'sold') {
      query = query.eq('status', 'sold');
    } else {
      query = query.neq('status', 'sold').eq('is_draft', false);
    }
    if (!isAdminEmail(actorEmail)) {
      query = query.or(privateProjectAccessOr(actorEmail));
    }

    const { data, error } = await query;
    if (error) throw error;
    const projects = (data || [])
      .filter(project => !isDeletedForUser(project, actorEmail))
      .map(project => ({
        id: project.id,
        title: project.title || 'Projeto Inicial',
        clientName: project.client_name || 'Cliente',
        contractNumber: project.contract_number || '',
        address: project.address || '',
        status: project.status || 'draft',
        isDraft: Boolean(project.is_draft),
        draftSavedAt: project.draft_saved_at || null,
        updatedAt: project.updated_at || null,
        deletedAt: project.deleted_at || null,
        deletedBy: project.deleted_by || '',
        deletedReason: project.deleted_reason || '',
        designerEmail: normalizeEmail(project.assigned_to_email || project.created_by || project.last_editor_email),
        designerName: project.last_editor_name || designerNameFromEmail(project.assigned_to_email || project.created_by || project.last_editor_email),
      }));

    sendJson(response, 200, { ok: true, source: 'server-supabase', projects });
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

async function uploadHtmlSnapshotToStorage(storagePath, html) {
  try {
    await ensureHtmlBucket();
    const { error: uploadError } = await supabaseServer.storage
      .from(htmlBucket)
      .upload(storagePath, new Blob([html], { type: 'text/html;charset=utf-8' }), {
        cacheControl: '60',
        contentType: 'text/html;charset=utf-8',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabaseServer.storage.from(htmlBucket).getPublicUrl(storagePath);
    const publicUrl = publicData?.publicUrl || '';
    return { publicUrl };
  } catch (error) {
    console.warn('Link persistido no banco, mas o espelho no Storage falhou.', error);
    return { publicUrl: '', warning: String(error?.message || error) };
  }
}

async function persistEditorState({ projectId, actor, action, draft, preview, settings, settingsMutation, eventId, createdAt }) {
  if (settings) {
    await saveSharedEditorSettings(settings, actor, settingsMutation || null);
  }

  if (!hasPersistableContent(draft, preview)) return;

  const existingProject = await loadProjectForWrite(projectId);
  if (existingProject?.status === 'sold') {
    throw new Error('Projeto vendido esta bloqueado para alteracoes.');
  }

  if (await hasAuditEvent(eventId)) return;
  if (isStaleProjectEvent(existingProject, createdAt)) {
    await persistAuditLog({ projectId, actor, action, draft, preview, settings, eventId, createdAt });
    return;
  }

  const client = preview?.client || {};
  const actorEmail = normalizeEmail(actor?.email);
  const isDraftSave = action === 'save_as_draft';
  const nowIso = new Date().toISOString();
  const createdBy = normalizeEmail(existingProject?.created_by) || actorEmail;
  const assignedToEmail = normalizeEmail(existingProject?.assigned_to_email) || actorEmail;
  const projectPayload = {
    id: projectId,
    title: preview?.projectType || 'Projeto Inicial',
    client_name: client.name || draft?.fields?.clientName || '',
    contract_number: client.contractNumber || draft?.fields?.contractNum || '',
    factory: Array.isArray(client.manufacturers) ? client.manufacturers.join(' + ') : '',
    address: client.address || draft?.fields?.endereco || '',
    document_type: 'projeto_inicial',
    status: isDraftSave ? 'draft' : (existingProject?.status || 'active'),
    owner_email: primaryAccountEmail,
    created_by: createdBy,
    updated_by: actorEmail,
    assigned_to_email: assignedToEmail,
    last_editor_email: actorEmail,
    last_editor_name: String(actor?.name || ''),
    is_draft: isDraftSave || Boolean(existingProject?.is_draft),
    draft_owner_email: isDraftSave ? actorEmail : (normalizeEmail(existingProject?.draft_owner_email) || createdBy || actorEmail),
    draft_saved_at: isDraftSave ? nowIso : existingProject?.draft_saved_at || null,
    data: {
      draft: draft || null,
      preview: preview || null,
      actor: actor || null,
      ownerEmail: primaryAccountEmail,
      createdBy,
      assignedToEmail,
      lastEditorEmail: actorEmail,
      lastEditorName: String(actor?.name || ''),
      lastAction: action || 'autosave',
      lastEventId: eventId || null,
      lastEventAt: createdAt || nowIso,
    },
  };

  const { error } = await supabaseServer
    .from('document_projects')
    .upsert(projectPayload, { onConflict: 'id' });
  if (error) throw error;
  await persistAuditLog({ projectId, actor, action, draft, preview, settings, eventId, createdAt });
}

function isStaleProjectEvent(existingProject, createdAt) {
  if (!existingProject?.data?.lastEventAt || !createdAt) return false;
  const lastEventTime = Date.parse(existingProject.data.lastEventAt);
  const incomingTime = Date.parse(createdAt);
  if (!Number.isFinite(lastEventTime) || !Number.isFinite(incomingTime)) return false;
  return incomingTime < lastEventTime;
}

async function loadProjectForWrite(projectId) {
  const { data, error } = await supabaseServer
    .from('document_projects')
    .select('id, status, data, owner_email, created_by, updated_by, assigned_to_email, last_editor_email, last_editor_name, is_draft, draft_owner_email, draft_saved_at, deleted_at, deleted_for_users')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function hasAuditEvent(eventId) {
  if (!eventId) return false;
  const { data: existing, error: readError } = await supabaseServer
    .from('editor_audit_logs')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle();
  if (readError) throw readError;
  return Boolean(existing?.id);
}

async function persistAuditLog({ projectId, actor, action, draft, preview, settings, eventId, createdAt }) {
  if (!eventId) return;
  const { error } = await supabaseServer
    .from('editor_audit_logs')
    .insert({
      project_id: projectId,
      event_id: eventId,
      actor_email: normalizeEmail(actor?.email),
      action: action || 'autosave',
      payload: {
        draft: draft ? { updatedAt: draft.updatedAt || null } : null,
        preview: preview ? { environments: Array.isArray(preview.environments) ? preview.environments.length : 0 } : null,
        settingsChanged: Boolean(settings),
      },
      created_at: createdAt || new Date().toISOString(),
    });
  if (error && error.code !== '23505') throw error;
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
  return {
    ...payload,
    catalogItems: mergeCatalogItemsPayload(tableSettings.catalogItems, payload.catalogItems, { preferIncoming: false }),
    materialOptions: mergeMaterialOptionsPayload(tableSettings.materialOptions, payload.materialOptions),
  };
}

async function saveSharedEditorSettings(incomingSettings, actor = null, settingsMutation = null) {
  const currentSettings = await loadSharedEditorSettings();
  const actorEmail = normalizeEmail(actor?.email);
  const hasIncomingSettings = incomingSettings && Object.keys(incomingSettings).length > 0;
  const mergedSettings = hasIncomingSettings
    ? mergeEditorSettingsPayload(currentSettings, incomingSettings, { protectCatalogCollections: true })
    : normalizeEditorSettingsPayload(currentSettings);
  const mutatedSettings = applySettingsMutation(mergedSettings, settingsMutation, actorEmail);
  const payload = await promoteSettingsImagesToStorage(mutatedSettings);
  const { error } = await supabaseServer
    .from('editor_settings')
    .upsert({
      settings_key: 'default',
      payload,
      updated_by: actorEmail || '',
    }, { onConflict: 'settings_key' });
  if (error) throw error;
  await persistSharedCatalogMutation(payload, settingsMutation, actorEmail).catch((tableError) => {
    console.warn('Configuracoes salvas, mas nao foi possivel espelhar catalogos nas tabelas.', tableError);
  });
  return payload;
}

async function promoteSettingsImagesToStorage(settings = {}) {
  const promoted = { ...settings };
  if (String(promoted.logo || '').startsWith('data:image/')) {
    const asset = await uploadDataUrlAsset({
      dataUrl: promoted.logo,
      folder: 'settings/logo',
      fileNameHint: 'logo',
    });
    promoted.logo = asset.publicUrl || promoted.logo;
    promoted.logoAsset = asset;
  }
  promoted.catalogItems = await Promise.all((promoted.catalogItems || []).map(async (item) => {
    const textureUrl = catalogItemTextureUrlPayload(item);
    if (!String(textureUrl || '').startsWith('data:image/')) return item;
    const asset = await uploadDataUrlAsset({
      dataUrl: textureUrl,
      folder: `catalog/${catalogItemGroup(item.type)}`,
      fileNameHint: item.name || item.id || 'material',
    });
    return {
      ...item,
      textureUrl: asset.publicUrl || textureUrl,
      imageUrl: asset.publicUrl || textureUrl,
      storageBucket: asset.storageBucket,
      storagePath: asset.storagePath,
      mimeType: asset.mimeType,
      size: asset.size,
      uploadedAt: asset.uploadedAt,
    };
  }));
  return promoted;
}

async function promoteDocumentImages({ projectId, draft, preview }) {
  return {
    draft: await promoteImageDataUrls(draft, `projects/${projectId}/draft`),
    preview: await promoteImageDataUrls(preview, `projects/${projectId}/preview`),
  };
}

async function promoteImageDataUrls(value, folder) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map(item => promoteImageDataUrls(item, folder)));
  }

  const imageFields = new Set(['src', 'photo', 'logo', 'textureUrl', 'imageUrl', 'imageData', 'img']);
  const promoted = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === 'string' && imageFields.has(key) && fieldValue.startsWith('data:image/')) {
      const asset = await uploadDataUrlAsset({
        dataUrl: fieldValue,
        folder,
        fileNameHint: key,
      });
      promoted[key] = asset.publicUrl || fieldValue;
      promoted[`${key}Asset`] = asset;
    } else {
      promoted[key] = await promoteImageDataUrls(fieldValue, folder);
    }
  }
  return promoted;
}

async function uploadDataUrlAsset({ dataUrl, folder, fileNameHint }) {
  const parsed = parseDataUrl(dataUrl);
  const hash = createHash('sha256').update(parsed.buffer).digest('hex');
  const extension = extensionFromMime(parsed.mimeType);
  const safeName = slugify(fileNameHint || 'asset') || 'asset';
  const storagePath = `${folder}/${safeName}-${hash.slice(0, 24)}.${extension}`;
  const { error } = await supabaseServer.storage
    .from(photoBucket)
    .upload(storagePath, parsed.buffer, {
      cacheControl: '31536000',
      contentType: parsed.mimeType,
      upsert: true,
    });
  if (error) throw error;
  const { data } = supabaseServer.storage.from(photoBucket).getPublicUrl(storagePath);
  return {
    id: hash,
    storageBucket: photoBucket,
    storagePath,
    publicUrl: data?.publicUrl || '',
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
    uploadedAt: new Date().toISOString(),
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('Imagem em data URL invalida.');
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function extensionFromMime(mimeType = '') {
  return {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }[mimeType] || 'bin';
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

function mergeEditorSettingsPayload(current = {}, incoming = {}, options = {}) {
  const currentSettings = current || {};
  const incomingSettings = incoming || {};
  const currentCatalogItems = normalizeCatalogItemsPayload(currentSettings.catalogItems);
  const incomingCatalogItems = normalizeCatalogItemsPayload(incomingSettings.catalogItems);
  const currentMaterialOptions = normalizeMaterialOptionsPayload(currentSettings.materialOptions);
  const catalogItems = options.protectCatalogCollections && currentCatalogItems.length
    ? currentCatalogItems
    : mergeCatalogItemsPayload(currentCatalogItems, incomingCatalogItems, { preferIncoming: false });
  const materialOptions = options.protectCatalogCollections && hasMaterialOptionsPayload(currentMaterialOptions)
    ? currentMaterialOptions
    : mergeMaterialOptionsPayload(currentMaterialOptions, incomingSettings.materialOptions);
  return {
    ...currentSettings,
    ...incomingSettings,
    logo: incomingSettings.logo || currentSettings.logo || '',
    catalogItems,
    observations: [...new Set([...(currentSettings.observations || []), ...(incomingSettings.observations || [])])],
    materialOptions,
  };
}

function hasMaterialOptionsPayload(options = {}) {
  return Object.values(options || {}).some(values => Array.isArray(values) && values.length);
}

function applySettingsMutation(settings = {}, mutation = null, actorEmail = '') {
  const payload = normalizeEditorSettingsPayload(settings);
  if (!mutation?.type) return payload;
  if (mutation.type === 'catalog-item-upsert' && mutation.item) {
    if (isStaleCatalogMutation(payload.catalogItems, mutation, [mutation.previousId, mutation.previousCatalogKey])) return payload;
    const mutationTimestamp = mutation.createdAt || new Date().toISOString();
    payload.catalogItems = upsertCatalogItemPayload(payload.catalogItems, {
      ...mutation.item,
      updatedBy: actorEmail || mutation.item.updatedBy || '',
      updatedAt: mutationTimestamp,
    }, [mutation.previousId, mutation.previousCatalogKey]);
  }
  if (mutation.type === 'catalog-item-delete') {
    if (isStaleCatalogMutation(payload.catalogItems, mutation)) return payload;
    payload.catalogItems = removeCatalogItemsPayload(payload.catalogItems, [mutation]);
  }
  if (mutation.type === 'catalog-items-delete') {
    payload.catalogItems = removeCatalogItemsPayload(
      payload.catalogItems,
      (mutation.items || []).filter(item => !isStaleCatalogMutation(payload.catalogItems, { ...item, createdAt: mutation.createdAt }))
    );
  }
  if (mutation.type === 'material-option-upsert' && mutation.group && mutation.value) {
    payload.materialOptions = upsertMaterialOptionPayload(payload.materialOptions, mutation);
  }
  if (mutation.type === 'material-option-delete' && mutation.group && mutation.value) {
    payload.materialOptions = deleteMaterialOptionPayload(payload.materialOptions, mutation.group, mutation.value);
  }
  return payload;
}

function isStaleCatalogMutation(items = [], mutation = {}, previousKeys = []) {
  if (!mutation?.createdAt) return false;
  const incomingTime = Date.parse(mutation.createdAt);
  if (!Number.isFinite(incomingTime)) return false;
  const existingItem = findCatalogItemForMutation(items, mutation.item || mutation, previousKeys);
  if (!existingItem) return false;
  const existingTime = Date.parse(existingItem.updatedAt || existingItem.updated_at || existingItem.uploadedAt || existingItem.createdAt || '');
  return Number.isFinite(existingTime) && existingTime > incomingTime;
}

function catalogItemTextureUrlPayload(item = {}) {
  return item.textureUrl
    || item.imageUrl
    || item.imageData
    || item.publicUrl
    || item.texture_url
    || item.image_url
    || item.image_data
    || item.public_url
    || item.data?.textureUrl
    || item.data?.imageUrl
    || item.data?.publicUrl
    || item.data?.image
    || '';
}

function normalizeCatalogItemsPayload(items = []) {
  const merged = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || !item.name) return;
    const textureUrl = catalogItemTextureUrlPayload(item);
    const normalizedItem = textureUrl
      ? { ...item, textureUrl, imageUrl: item.imageUrl || textureUrl }
      : { ...item };
    normalizedItem.catalogKey = stableCatalogKey({
      category: catalogItemGroup(normalizedItem.type || normalizedItem.category),
      factory: normalizedItem.manufacturer || normalizedItem.factory || '',
      line: normalizedItem.line || normalizedItem.line_name || normalizedItem.lineName || '',
      quality: normalizedItem.quality || normalizedItem.materialType || '',
      name: normalizedItem.name,
    });
    normalizedItem.catalog_key = normalizedItem.catalogKey;
    const key = [
      normalizedItem.id,
      normalizedItem.catalogKey,
    ].filter(Boolean).join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalizedItem);
  });
  return preferAdminCatalogItems(merged);
}

function preferAdminCatalogItems(items = []) {
  return items;
}

function mergeCatalogItemsPayload(current = [], incoming = [], options = {}) {
  let merged = [];
  const preferIncoming = options.preferIncoming !== false;
  const firstItems = preferIncoming ? current : incoming;
  const secondItems = preferIncoming ? incoming : current;
  normalizeCatalogItemsPayload(firstItems).forEach((item) => {
    if (!item || !item.name) return;
    merged = upsertCatalogItemPayload(merged, item);
  });
  normalizeCatalogItemsPayload(secondItems).forEach((item) => {
    if (!item || !item.name) return;
    merged = upsertCatalogItemPayload(merged, item);
  });
  return merged;
}

function catalogItemPayloadMatchKeys(item = {}) {
  if (!item) return [];
  return [
    item.id,
    item.catalogKey,
    item.catalog_key,
    stableCatalogKey({
      category: catalogItemGroup(item.type || item.category),
      factory: item.manufacturer || item.factory || '',
      line: item.line || item.line_name || item.lineName || '',
      quality: item.quality || item.materialType || '',
      name: item.name || '',
    }),
  ].filter(Boolean).map(value => String(value).toLowerCase());
}

function upsertCatalogItemPayload(items = [], incomingItem, previousKeys = []) {
  const normalizedItem = normalizeCatalogItemsPayload([incomingItem])[0];
  if (!normalizedItem) return items || [];
  const matchKeys = new Set([
    ...catalogItemPayloadMatchKeys(normalizedItem),
    ...previousKeys.filter(Boolean).map(value => String(value).toLowerCase()),
  ]);
  let replaced = false;
  const next = (items || []).map((item) => {
    const keys = catalogItemPayloadMatchKeys(item);
    if (!replaced && keys.some(key => matchKeys.has(key))) {
      replaced = true;
      return mergeCatalogItemPayload(item, normalizedItem);
    }
    return item;
  });
  if (!replaced) next.push(normalizedItem);
  return next;
}

function mergeCatalogItemPayload(existingItem = {}, incomingItem = {}) {
  const existingImage = catalogItemTextureUrlPayload(existingItem);
  const incomingImage = catalogItemTextureUrlPayload(incomingItem);
  const image = incomingImage || existingImage;
  const merged = {
    ...existingItem,
    ...incomingItem,
  };
  if (image) {
    merged.textureUrl = image;
    merged.imageUrl = image;
  }
  if (!incomingItem.storageBucket && existingItem.storageBucket) merged.storageBucket = existingItem.storageBucket;
  if (!incomingItem.storagePath && existingItem.storagePath) merged.storagePath = existingItem.storagePath;
  if (!incomingItem.publicUrl && existingItem.publicUrl) merged.publicUrl = existingItem.publicUrl;
  if (!incomingItem.mimeType && existingItem.mimeType) merged.mimeType = existingItem.mimeType;
  return normalizeCatalogItemsPayload([merged])[0] || merged;
}

function removeCatalogItemsPayload(items = [], selectors = []) {
  const removeKeys = new Set((selectors || []).flatMap(selector => [
    selector?.id,
    selector?.catalogKey,
    selector?.catalog_key,
  ]).filter(Boolean).map(value => String(value).toLowerCase()));
  if (!removeKeys.size) return items || [];
  return (items || []).filter(item => !catalogItemPayloadMatchKeys(item).some(key => removeKeys.has(key)));
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

function upsertMaterialOptionPayload(options = {}, mutation = {}) {
  const next = normalizeMaterialOptionsPayload(options);
  if (mutation.previousGroup && mutation.previousValue) {
    next[mutation.previousGroup] = (next[mutation.previousGroup] || []).filter(value => value !== mutation.previousValue);
  }
  next[mutation.group] = [...new Set([...(next[mutation.group] || []), mutation.value])];
  return next;
}

function deleteMaterialOptionPayload(options = {}, group, value) {
  const next = normalizeMaterialOptionsPayload(options);
  next[group] = (next[group] || []).filter(option => option !== value);
  return next;
}

async function loadSettingsFromSharedCatalogTables() {
  const [materialsResult, optionsResult] = await Promise.all([
    supabaseServer
      .from('catalog_materials')
      .select('id,catalog_key,group_key,name,code,manufacturer,line_name,quality,material_type,category,hex,texture_url,image_url,storage_bucket,storage_path,public_url,mime_type,width,height,active,sort_order,created_by,updated_by,created_at,updated_at,data')
      .eq('active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .limit(500),
    supabaseServer
      .from('catalog_options')
      .select('group_key, label, sort_order')
      .eq('active', true)
      .is('deleted_at', null)
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
  const textureUrl = data.textureUrl || data.imageUrl || row.public_url || row.image_url || row.texture_url || '';
  return {
    id: data.id || row.catalog_key || `${row.group_key}-${row.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    catalogKey: row.catalog_key || data.catalogKey || '',
    catalog_key: row.catalog_key || data.catalogKey || '',
    type,
    category: data.category || row.category || row.group_key || '',
    factory: data.factory || data.manufacturer || row.manufacturer || '',
    manufacturer: data.manufacturer || row.manufacturer || '',
    line: data.line || data.line_name || row.line_name || '',
    name: data.name || row.name,
    quality: data.quality || row.quality || '',
    materialType: data.materialType || row.material_type || row.quality || '',
    hex: data.hex || row.hex || '#b8976a',
    textureUrl,
    imageUrl: textureUrl,
    storageBucket: data.storageBucket || row.storage_bucket || '',
    storagePath: data.storagePath || row.storage_path || '',
    publicUrl: data.publicUrl || row.public_url || row.image_url || '',
    storage_path: data.storagePath || row.storage_path || '',
    public_url: data.publicUrl || row.public_url || row.image_url || '',
    mimeType: data.mimeType || row.mime_type || '',
    mime_type: data.mimeType || row.mime_type || '',
    width: data.width || row.width || null,
    height: data.height || row.height || null,
    active: row.active !== false,
    sort_order: row.sort_order ?? 0,
    createdBy: data.createdBy || row.created_by || '',
    updatedBy: data.updatedBy || row.updated_by || '',
    created_by: data.createdBy || row.created_by || '',
    updated_by: data.updatedBy || row.updated_by || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
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

async function persistSharedCatalogMutation(settings = {}, mutation = null, actorEmail = '') {
  if (!mutation?.type) return;
  if (mutation.type === 'catalog-item-upsert' && mutation.item) {
    if (isStaleCatalogMutation(settings.catalogItems || [], mutation, [mutation.previousId, mutation.previousCatalogKey])) return;
    const item = findCatalogItemForMutation(settings.catalogItems || [], mutation.item, [mutation.previousId, mutation.previousCatalogKey]);
    if (!item) return;
    await upsertSharedCatalogItem(item, actorEmail);
    const nextCatalogKey = item.catalogKey || item.catalog_key || catalogMaterialKeyFromItem(item);
    if (mutation.previousCatalogKey && mutation.previousCatalogKey !== nextCatalogKey) {
      await softDeleteSharedCatalogItem({ catalogKey: mutation.previousCatalogKey }, actorEmail, 'catalog_item_key_changed');
    }
    return;
  }
  if (mutation.type === 'catalog-item-delete') {
    if (isStaleCatalogMutation(settings.catalogItems || [], mutation)) return;
    await softDeleteSharedCatalogItem(mutation, actorEmail, 'catalog_item_removed');
    return;
  }
  if (mutation.type === 'catalog-items-delete') {
    for (const item of mutation.items || []) {
      if (isStaleCatalogMutation(settings.catalogItems || [], { ...item, createdAt: mutation.createdAt })) continue;
      await softDeleteSharedCatalogItem(item, actorEmail, 'catalog_item_removed');
    }
    return;
  }
  if (mutation.type === 'material-option-upsert' && mutation.group && mutation.value) {
    if (mutation.previousGroup && mutation.previousValue && (mutation.previousGroup !== mutation.group || mutation.previousValue !== mutation.value)) {
      await softDeleteSharedCatalogOption(mutation.previousGroup, mutation.previousValue, actorEmail, 'catalog_option_changed');
    }
    await upsertSharedCatalogOption(mutation.group, mutation.value, settings.catalogItems || [], actorEmail);
    return;
  }
  if (mutation.type === 'material-option-delete' && mutation.group && mutation.value) {
    await softDeleteSharedCatalogOption(mutation.group, mutation.value, actorEmail, 'catalog_option_removed');
  }
}

function findCatalogItemForMutation(items = [], incomingItem = {}, previousKeys = []) {
  const matchKeys = new Set([
    ...catalogItemPayloadMatchKeys(incomingItem),
    ...previousKeys.filter(Boolean).map(value => String(value).toLowerCase()),
  ]);
  return (items || []).find(item => catalogItemPayloadMatchKeys(item).some(key => matchKeys.has(key))) || null;
}

function catalogMaterialKeyFromItem(item = {}) {
  return stableCatalogKey({
    category: catalogItemGroup(item.type),
    factory: item.manufacturer || item.factory || '',
    line: item.line || item.line_name || '',
    quality: item.quality || item.materialType || '',
    name: item.name,
  });
}

function catalogMaterialRowFromItem(item, index = 0, actorEmail = '') {
  const groupKey = catalogItemGroup(item.type);
  const catalogKey = item.catalogKey || item.catalog_key || catalogMaterialKeyFromItem(item);
  return {
    catalog_key: catalogKey,
    group_key: groupKey,
    name: item.name,
    code: item.code || item.id || null,
    brand: item.brand || item.manufacturer || null,
    manufacturer: item.manufacturer || null,
    line_name: item.line || item.line_name || null,
    quality: item.quality || null,
    material_type: item.materialType || item.quality || null,
    category: item.category || groupKey,
    hex: item.hex || null,
    texture_url: item.textureUrl || item.imageUrl || null,
    image_data: null,
    image_url: String(item.textureUrl || item.imageUrl || '').startsWith('http') || String(item.textureUrl || item.imageUrl || '').startsWith('/')
      ? (item.textureUrl || item.imageUrl)
      : null,
    storage_bucket: item.storageBucket || photoBucket,
    storage_path: item.storagePath || null,
    public_url: item.publicUrl || item.imageUrl || item.textureUrl || null,
    mime_type: item.mimeType || (String(item.textureUrl || '').includes('.webp') ? 'image/webp' : null),
    width: Number(item.width) || null,
    height: Number(item.height) || null,
    sort_order: Number(item.sort_order ?? index) || 0,
    active: true,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    restored_at: new Date().toISOString(),
    restored_by: actorEmail || primaryAccountEmail,
    owner_email: primaryAccountEmail,
    created_by: item.createdBy || actorEmail || primaryAccountEmail,
    updated_by: actorEmail || primaryAccountEmail,
    data: { ...item, catalogKey },
  };
}

async function upsertSharedCatalogItem(item, actorEmail = '') {
  if (!item?.name) return;
  const { error } = await supabaseServer
    .from('catalog_materials')
    .upsert([catalogMaterialRowFromItem(item, 0, actorEmail)], { onConflict: 'catalog_key' });
  if (error) throw error;
}

async function softDeleteSharedCatalogItem(selector = {}, actorEmail = '', reason = 'catalog_item_removed') {
  const catalogKey = selector.catalogKey || selector.catalog_key;
  if (!catalogKey) return;
  const { error } = await supabaseServer
    .from('catalog_materials')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: actorEmail || primaryAccountEmail,
      deleted_reason: reason,
      updated_by: actorEmail || primaryAccountEmail,
    })
    .eq('catalog_key', catalogKey);
  if (error) throw error;
}

async function upsertSharedCatalogOption(group, label, catalogItems = [], actorEmail = '') {
  const image = catalogItems
    .map(item => {
      const optionGroup = catalogItemOptionGroup(item.type);
      const optionLabel = `${item.name}${item.line ? ' Â· ' + item.line : ''}`;
      return optionGroup === group && optionLabel === label ? (item.textureUrl || item.imageUrl || '') : '';
    })
    .find(Boolean) || '';
  const { error } = await supabaseServer
    .from('catalog_options')
    .upsert([{
      group_key: group,
      label,
      sort_order: 0,
      active: true,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null,
      restored_at: new Date().toISOString(),
      restored_by: actorEmail || primaryAccountEmail,
      image_data: null,
      image_url: String(image).startsWith('http') || String(image).startsWith('/') ? image : null,
      updated_by: actorEmail || primaryAccountEmail,
      data: image ? { image } : {},
    }], { onConflict: 'group_key,label' });
  if (error) throw error;
}

async function softDeleteSharedCatalogOption(group, label, actorEmail = '', reason = 'catalog_option_removed') {
  if (!group || !label) return;
  const { error } = await supabaseServer
    .from('catalog_options')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: actorEmail || primaryAccountEmail,
      deleted_reason: reason,
      updated_by: actorEmail || primaryAccountEmail,
    })
    .eq('group_key', group)
    .eq('label', label);
  if (error) throw error;
}

async function persistSharedCatalogTables(settings = {}, actorEmail = '') {
  const catalogItems = Array.isArray(settings.catalogItems) ? settings.catalogItems : [];
  const materialOptions = settings.materialOptions || {};
  const catalogGroups = [...new Set(['color', 'puxador', 'porta', 'corredica', ...catalogItems.map(item => catalogItemGroup(item.type)).filter(Boolean)])];
  const optionGroups = [...new Set(['tampon', 'porta', 'puxador', 'corredica', ...Object.keys(materialOptions || {})])];

  const materialRows = catalogItems
    .filter(item => item?.name)
    .map((item, index) => {
      const groupKey = catalogItemGroup(item.type);
      const catalogKey = stableCatalogKey({
        category: groupKey,
        factory: item.manufacturer || item.factory || '',
        line: item.line || item.line_name || '',
        quality: item.quality || item.materialType || '',
        name: item.name,
      });
      return {
      catalog_key: catalogKey,
      group_key: groupKey,
      name: item.name,
      code: item.code || item.id || null,
      brand: item.brand || item.manufacturer || null,
      manufacturer: item.manufacturer || null,
      line_name: item.line || item.line_name || null,
      quality: item.quality || null,
      material_type: item.materialType || item.quality || null,
      category: item.category || groupKey,
      hex: item.hex || null,
      texture_url: item.textureUrl || item.imageUrl || null,
      image_data: null,
      image_url: String(item.textureUrl || item.imageUrl || '').startsWith('http') || String(item.textureUrl || item.imageUrl || '').startsWith('/')
        ? (item.textureUrl || item.imageUrl)
        : null,
      storage_bucket: item.storageBucket || photoBucket,
      storage_path: item.storagePath || null,
      public_url: item.publicUrl || item.imageUrl || item.textureUrl || null,
      mime_type: item.mimeType || (String(item.textureUrl || '').includes('.webp') ? 'image/webp' : null),
      width: Number(item.width) || null,
      height: Number(item.height) || null,
      sort_order: index,
      active: true,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null,
      restored_at: new Date().toISOString(),
      restored_by: actorEmail || primaryAccountEmail,
      owner_email: primaryAccountEmail,
      created_by: item.createdBy || actorEmail || primaryAccountEmail,
      updated_by: actorEmail || primaryAccountEmail,
      data: { ...item, catalogKey },
    };
    });

  if (materialRows.length) {
    const { error } = await supabaseServer
      .from('catalog_materials')
      .upsert(materialRows, { onConflict: 'catalog_key' });
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
        deleted_at: null,
        deleted_by: null,
        deleted_reason: null,
        restored_at: new Date().toISOString(),
        restored_by: actorEmail || primaryAccountEmail,
        image_data: null,
        image_url: String(image).startsWith('http') || String(image).startsWith('/') ? image : null,
        updated_by: actorEmail || primaryAccountEmail,
        data: image ? { image } : {},
      };
    });
  });

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

function stableCatalogKey({ category, factory, line, quality, name }) {
  return normalizeCatalogKey([category, factory, line, quality, name].join(':'));
}

function normalizeCatalogKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'catalog-item';
}

function escapePostgrestLike(value) {
  return String(value || '').replace(/[,%]/g, '');
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

function isAdminEmail(email) {
  return normalizeEmail(email) === primaryAccountEmail;
}

function privateProjectAccessOr(email) {
  const safeEmail = escapePostgrestValue(normalizeEmail(email));
  return `assigned_to_email.eq.${safeEmail},created_by.eq.${safeEmail},draft_owner_email.eq.${safeEmail}`;
}

function escapePostgrestValue(value) {
  return String(value || '').replace(/"/g, '\\"');
}

function canAccessPrivateProject(project, actorEmail) {
  const email = normalizeEmail(actorEmail);
  if (isAdminEmail(email)) return true;
  if (!email || !project) return false;
  if (project.deleted_at) return false;
  return [
    project.assigned_to_email,
    project.created_by,
    project.draft_owner_email,
  ].map(normalizeEmail).includes(email) && !isDeletedForUser(project, email);
}

function isDeletedForUser(project, actorEmail) {
  if (isAdminEmail(actorEmail)) return false;
  const deleted = Array.isArray(project?.deleted_for_users) ? project.deleted_for_users : [];
  return deleted.map(normalizeEmail).includes(normalizeEmail(actorEmail));
}

async function persistHtmlVersion({ projectId, versionNumber, shareSlug, storagePath, publicUrl, storagePublicUrl, html, preview, actor, draft, eventId, createdAt }) {
  const client = preview.client || {};
  const actorEmail = normalizeEmail(actor?.email);
  const existingProject = await loadProjectForWrite(projectId);
  if (existingProject?.status === 'sold') {
    throw new Error('Projeto vendido esta bloqueado para alteracoes.');
  }
  if (existingProject && !canAccessPrivateProject(existingProject, actorEmail)) {
    throw new Error('forbidden_project_access');
  }
  const createdBy = normalizeEmail(existingProject?.created_by) || actorEmail;
  const assignedToEmail = normalizeEmail(existingProject?.assigned_to_email) || actorEmail;

  if (eventId) {
    const { data: existingVersion, error: existingError } = await supabaseServer
      .from('document_html_versions')
      .select('id, project_id, storage_path, data')
      .filter('data->>eventId', 'eq', eventId)
      .eq('shared_with_client', true)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingVersion?.id) {
      return {
        versionId: existingVersion.id,
        publicUrl: existingVersion.data?.publicUrl || publicUrl,
        storagePath: existingVersion.storage_path || storagePath,
        storagePublicUrl: existingVersion.data?.storagePublicUrl || '',
        shareSlug: existingVersion.data?.shareSlug || '',
        deduped: true,
      };
    }
  }

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
      status: existingProject?.status || 'active',
      owner_email: primaryAccountEmail,
      created_by: createdBy,
      updated_by: actorEmail,
      assigned_to_email: assignedToEmail,
      last_editor_email: actorEmail,
      last_editor_name: String(actor?.name || ''),
      is_draft: false,
      data: { draft: draft || null, preview, actor: actor || null, ownerEmail: primaryAccountEmail, createdBy, assignedToEmail, lastEditorEmail: actorEmail, lastEditorName: String(actor?.name || ''), lastEventId: eventId || null, lastEventAt: createdAt || new Date().toISOString() },
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
    assigned_to_email: assignedToEmail,
    owner_email: primaryAccountEmail,
    share_slug: shareSlug,
    data: {
      publicUrl,
      storagePublicUrl,
      client,
      shareSlug,
      eventId: eventId || null,
      sharedWithClient: true,
      sharedAt: new Date().toISOString(),
      createdBy: actorEmail,
      assignedToEmail,
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
    const { error: supersedeError } = await supabaseServer
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
    if (supersedeError) throw supersedeError;

    const { error: currentError } = await supabaseServer
      .from('document_projects')
      .update({ current_html_id: insertedVersion.id })
      .eq('id', projectId);
    if (currentError) throw currentError;
  }

  return { versionId: insertedVersion?.id || '' };
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
