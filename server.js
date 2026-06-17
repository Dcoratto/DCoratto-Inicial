import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const localEnvKeys = new Set();
loadLocalEnvFile('.env');
loadLocalEnvFile('.env.local', true);

const port = Number(process.env.PORT || 4173);
const root = resolve('dist');
const publicRoot = resolve('public');
const indexFile = join(root, 'index.html');
const htmlBucket = process.env.SUPABASE_HTML_BUCKET || process.env.VITE_SUPABASE_HTML_BUCKET || 'dcoratto-html';
const photoBucket = process.env.SUPABASE_PHOTOS_BUCKET || process.env.VITE_SUPABASE_PHOTOS_BUCKET || 'dcoratto-photos';
const clientMobileFirstVersion = '2026-06-08-mobile-contain-markers-v1';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SERVICE_ROLE_KEY
  || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  || '';
const primaryAccountEmail = 'dcorattoinovacao@gmail.com';
const defaultFactories = ['VITTA', 'BOA VISTA'];
const localLoginUsers = [
  { email: primaryAccountEmail, password: 'sob_medida', name: "D'Coratto Inovacao", role: 'owner' },
  { email: 'rafael@dcoratto.com.br', password: 'Dcoratto@Rafael26', name: 'Rafael', role: 'team' },
  { email: 'isabela@dcoratto.com.br', password: 'Dcoratto@Isabela26', name: 'Isabela', role: 'team' },
  { email: 'vinicius@dcoratto.com.br', password: 'Dcoratto@Vinicius26', name: 'Vinicius', role: 'team' },
];
const runtimeLoginUsers = localLoginUsers.map(user => ({ ...user }));
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

  if (request.method === 'GET' && url.pathname === '/api/app-users') {
    await handleAppUsersGet(url, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/app-users') {
    await handleAppUsersUpsert(request, response);
    return;
  }

  if (request.method === 'DELETE' && url.pathname === '/api/app-users') {
    await handleAppUsersDelete(url, response);
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

  if (request.method === 'POST' && url.pathname === '/api/project-restore') {
    await handleProjectRestoreRequest(request, response);
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
        if (!error) {
          sendJson(response, 401, { error: 'Credenciais incorretas.' });
          return;
        }
      } catch (error) {
        console.warn('Login por Supabase indisponivel; usando fallback local.', error);
      }
    }

    const fallbackUser = runtimeLoginUsers.find((user) => user.email === email && user.password === password && user.active !== false);
    if (!fallbackUser) {
      sendJson(response, 401, { error: 'Credenciais incorretas.' });
      return;
    }

    sendJson(response, 200, { ok: true, source: 'local', user: normalizeAppUser(fallbackUser) });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
}

async function handleAppUsersGet(url, response) {
  try {
    const actorEmail = normalizeEmail(url.searchParams.get('actor'));
    if (!canManageAppUsers(actorEmail)) {
      sendJson(response, 403, { error: 'Apenas a conta principal pode gerenciar funcionarios.' });
      return;
    }

    if (!supabaseServer) {
      sendJson(response, 200, {
        ok: true,
        source: 'local',
        users: runtimeLoginUsers
          .filter(user => user.active !== false)
          .map(publicAppUser)
          .sort(sortAppUsers),
      });
      return;
    }

    const { data, error } = await supabaseServer
      .from('app_users')
      .select('email, display_name, role, active, created_at, updated_at')
      .eq('active', true)
      .order('display_name', { ascending: true })
      .order('email', { ascending: true });
    if (error) throw error;

    sendJson(response, 200, {
      ok: true,
      source: 'supabase',
      users: (data || []).map(publicAppUser).sort(sortAppUsers),
    });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
}

async function handleAppUsersUpsert(request, response) {
  try {
    const body = await readJsonBody(request);
    const actorEmail = normalizeEmail(body.actor?.email);
    if (!canManageAppUsers(actorEmail)) {
      sendJson(response, 403, { error: 'Apenas a conta principal pode gerenciar funcionarios.' });
      return;
    }

    const originalEmail = normalizeEmail(body.originalEmail);
    const email = normalizeEmail(body.email);
    const name = String(body.name || '').trim();
    const role = normalizeAppUserRole(body.role);
    const password = String(body.password || '');
    const validationError = validateAppUserInput({ email, name, password, isNew: !originalEmail });
    if (validationError) {
      sendJson(response, 400, { error: validationError });
      return;
    }

    if (email === primaryAccountEmail && role !== 'owner') {
      sendJson(response, 400, { error: 'A conta principal deve permanecer como proprietaria.' });
      return;
    }

    if (!supabaseServer) {
      const user = upsertRuntimeLoginUser({ originalEmail, email, name, role, password });
      sendJson(response, 200, { ok: true, source: 'local', user: publicAppUser(user) });
      return;
    }

    const { data, error } = await supabaseServer.rpc('upsert_app_user', {
      manager_email: actorEmail,
      original_email: originalEmail || '',
      user_email: email,
      user_display_name: name,
      user_role: role,
      user_password: password,
    });
    if (error) throw error;
    sendJson(response, 200, { ok: true, source: 'supabase', user: publicAppUser(data?.user || data) });
  } catch (error) {
    sendJson(response, 500, { error: normalizeAppUserError(error) });
  }
}

async function handleAppUsersDelete(url, response) {
  try {
    const actorEmail = normalizeEmail(url.searchParams.get('actor'));
    const email = normalizeEmail(url.searchParams.get('email'));
    if (!canManageAppUsers(actorEmail)) {
      sendJson(response, 403, { error: 'Apenas a conta principal pode gerenciar funcionarios.' });
      return;
    }
    if (!email) {
      sendJson(response, 400, { error: 'Informe o funcionario para excluir.' });
      return;
    }
    if (email === primaryAccountEmail) {
      sendJson(response, 400, { error: 'A conta principal nao pode ser excluida.' });
      return;
    }

    if (!supabaseServer) {
      const user = runtimeLoginUsers.find(item => item.email === email);
      if (user) user.active = false;
      sendJson(response, 200, { ok: true, source: 'local', email });
      return;
    }

    const { error } = await supabaseServer
      .from('app_users')
      .update({ active: false })
      .eq('email', email);
    if (error) throw error;
    sendJson(response, 200, { ok: true, source: 'supabase', email });
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
    let preview = sanitizeClientPreview(promotedDocument.preview || {});
    const protectedDocument = protectAgainstImplicitContentLoss({
      existingProject,
      action: 'generate_project_initial',
      draft: promotedDocument.draft,
      preview,
    });
    promotedDocument.draft = protectedDocument.draft;
    preview = protectedDocument.preview || preview;
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
      mobileFirst: true,
      mobileLayoutVersion: clientMobileFirstVersion,
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
        .neq('status', 'sold')
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
        is_draft: status === 'draft' ? true : status === 'sold' ? false : Boolean(current?.is_draft),
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

async function handleProjectRestoreRequest(request, response) {
  try {
    if (!supabaseServer) {
      sendJson(response, 503, {
        error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor para restaurar projetos.',
      });
      return;
    }

    const body = await readJsonBody(request);
    const projectId = safeId(body.projectId);
    const actorEmail = normalizeEmail(body.actor?.email);
    if (!projectId) {
      sendJson(response, 400, { error: 'Projeto invalido para restauracao.' });
      return;
    }
    if (!(await canRestoreProjects(actorEmail))) {
      sendJson(response, 403, { error: 'Apenas a conta admin pode restaurar projetos.' });
      return;
    }

    const restored = await restoreBestProjectSnapshot({ projectId, actor: body.actor || null });
    sendJson(response, 200, {
      ok: true,
      source: restored.source,
      projectId,
      environments: restored.environments,
      restoredAt: restored.restoredAt,
    });
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
    response.end(await optimizeClientHtmlForMobile(html));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Nao foi possivel abrir o HTML do cliente: ${String(error?.message || error)}`);
  }
}

let cachedClientMobileCss = '';

async function optimizeClientHtmlForMobile(html = '') {
  if (!html) return html;
  if (clientHtmlIsCurrentMobileFirst(html)) {
    return html;
  }
  const preview = extractPreviewFromHtmlContent(html);
  if (preview) {
    try {
      return await buildStandaloneHtml(preview);
    } catch (error) {
      console.warn('Nao foi possivel reconstruir HTML mobile-first do cliente. Aplicando patch CSS de fallback.', error);
    }
  }
  if (html.includes('data-dcoratto-mobile-client-optimized')) return html;
  const css = clientMobileCssPatch();
  if (!css) return html;
  const style = `<style data-dcoratto-mobile-client-optimized="${clientMobileFirstVersion}">\n${css}\n</style>`;
  return html.includes('</head>')
    ? html.replace('</head>', `${style}</head>`)
    : `${style}${html}`;
}

function clientHtmlIsCurrentMobileFirst(html = '') {
  return html.includes(`__DCORATTO_CLIENT_MOBILE_FIRST__ = ${JSON.stringify(clientMobileFirstVersion)}`)
    || html.includes(`data-dcoratto-mobile-first="${clientMobileFirstVersion}"`);
}

function clientMobileCssPatch() {
  if (cachedClientMobileCss) return cachedClientMobileCss;
  const template = readPortfolioTemplateSync();
  const match = template.match(/\/\* dcoratto-client-mobile-v1 \*\/([\s\S]*?)\/\* \/dcoratto-client-mobile-v1 \*\//);
  cachedClientMobileCss = match?.[1]?.trim() || '';
  return cachedClientMobileCss;
}

function portfolioTemplateCandidates() {
  return [join(root, 'portfolio_document.html'), join(publicRoot, 'portfolio_document.html')];
}

function isMobileFirstPortfolioTemplate(template = '') {
  return template.includes('renderMobileFrameFlow')
    && template.includes('mobile-frame-flow')
    && template.includes('has-mobile-flow');
}

function choosePortfolioTemplate(candidates = []) {
  return candidates.find(candidate => isMobileFirstPortfolioTemplate(candidate.content))
    || candidates[0]
    || { content: '', path: '' };
}

function readPortfolioTemplateSync() {
  const candidates = portfolioTemplateCandidates()
    .filter(path => existsSync(path))
    .map(path => ({ path, content: readFileSync(path, 'utf8') }));
  return choosePortfolioTemplate(candidates).content;
}

async function readPortfolioTemplate() {
  const candidates = [];
  for (const path of portfolioTemplateCandidates()) {
    if (!existsSync(path)) continue;
    candidates.push({ path, content: await readFile(path, 'utf8') });
  }
  return choosePortfolioTemplate(candidates).content;
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

  const protectedDocument = protectAgainstImplicitContentLoss({
    existingProject,
    action,
    draft,
    preview,
  });
  draft = protectedDocument.draft;
  preview = protectedDocument.preview;
  const persistenceAction = protectedDocument.protected
    ? `${action || 'editor_sync'}_content_preserved`
    : action;

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
      lastAction: persistenceAction || 'autosave',
      lastEventId: eventId || null,
      lastEventAt: createdAt || nowIso,
      contentPreservedFromImplicitLoss: Boolean(protectedDocument.protected),
    },
  };

  const { error } = await supabaseServer
    .from('document_projects')
    .upsert(projectPayload, { onConflict: 'id' });
  if (error) throw error;
  await persistAuditLog({ projectId, actor, action: persistenceAction, draft, preview, settings, eventId, createdAt });
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
        snapshot: {
          draft: draft || null,
          preview: preview || null,
          settings: settings || null,
        },
      },
      created_at: createdAt || new Date().toISOString(),
    });
  if (error && error.code !== '23505') throw error;
}

function protectAgainstImplicitContentLoss({ existingProject, action, draft, preview }) {
  if (!existingProject?.data || isExplicitDeletionAction(action)) {
    return { draft, preview, protected: false };
  }
  const previousDraft = existingProject.data?.draft || null;
  if (!projectDraftStructureWasReduced(previousDraft, draft)) {
    return { draft, preview, protected: false };
  }
  return {
    draft: previousDraft || draft || null,
    preview: existingProject.data?.preview || preview || null,
    protected: true,
  };
}

function isExplicitDeletionAction(action = '') {
  const normalized = String(action || '').toLowerCase();
  return normalized.includes('delete')
    || normalized.includes('deleted')
    || normalized.includes('removed')
    || normalized === 'portfolio_history_restore';
}

function projectDraftStructureWasReduced(previousDraft, incomingDraft) {
  if (!previousDraft || !incomingDraft) return false;
  const previousEnvironments = Array.isArray(previousDraft.ambientes) ? previousDraft.ambientes : [];
  const incomingEnvironments = Array.isArray(incomingDraft.ambientes) ? incomingDraft.ambientes : [];
  if (!previousEnvironments.length) return false;
  if (incomingEnvironments.length < previousEnvironments.length) return true;

  const incomingById = mapById(incomingEnvironments);
  return previousEnvironments.some((previousEnvironment) => {
    const incomingEnvironment = incomingById.get(String(previousEnvironment?.id || ''));
    if (previousEnvironment?.id && !incomingEnvironment) return true;
    if (!incomingEnvironment) return false;
    if (collectionWasReduced(previousEnvironment.photos, incomingEnvironment.photos)) return true;
    return nestedPagesWereReduced(previousEnvironment.pages, incomingEnvironment.pages);
  });
}

function nestedPagesWereReduced(previousPages = [], incomingPages = []) {
  if (collectionWasReduced(previousPages, incomingPages)) return true;
  const incomingById = mapById(incomingPages);
  return (Array.isArray(previousPages) ? previousPages : []).some((previousPage) => {
    const incomingPage = incomingById.get(String(previousPage?.id || ''));
    if (previousPage?.id && !incomingPage) return true;
    if (!incomingPage) return false;
    if (collectionWasReduced(previousPage.frames, incomingPage.frames)) return true;
    if (collectionWasReduced(previousPage.annotations, incomingPage.annotations)) return true;
    const incomingFramesById = mapById(incomingPage.frames);
    return (Array.isArray(previousPage.frames) ? previousPage.frames : []).some((previousFrame) => {
      const incomingFrame = incomingFramesById.get(String(previousFrame?.id || ''));
      if (previousFrame?.id && !incomingFrame) return true;
      if (!incomingFrame) return false;
      return collectionWasReduced(previousFrame.annotations, incomingFrame.annotations);
    });
  });
}

function collectionWasReduced(previous = [], incoming = []) {
  const previousList = Array.isArray(previous) ? previous : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (!previousList.length) return false;
  if (incomingList.length < previousList.length) return true;
  const previousIds = previousList.map(item => String(item?.id || '')).filter(Boolean);
  if (!previousIds.length) return false;
  const incomingIds = new Set(incomingList.map(item => String(item?.id || '')).filter(Boolean));
  return previousIds.some(id => !incomingIds.has(id));
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : [])
    .filter(item => item?.id)
    .map(item => [String(item.id), item]));
}

async function restoreBestProjectSnapshot({ projectId, actor }) {
  const current = await loadProjectForWrite(projectId);
  if (!current) throw new Error('Projeto nao encontrado para restauracao.');
  const actorEmail = normalizeEmail(actor?.email);
  const candidate = await findBestRestoreCandidate(projectId, current);
  if (!candidate) throw new Error('Nenhum snapshot restauravel foi encontrado para este projeto.');

  const currentData = current.data && typeof current.data === 'object' ? current.data : {};
  const preview = candidate.snapshot.preview || currentData.preview || null;
  const draft = candidate.snapshot.draft || draftFromPreview(preview, currentData.draft || null);
  if (!hasPersistableContent(draft, preview)) {
    throw new Error('O snapshot encontrado nao possui ambientes para restaurar.');
  }

  const client = preview?.client || {};
  const restoredAt = new Date().toISOString();
  const status = current.status === 'sold' ? 'sold' : (current.is_draft ? 'draft' : 'active');
  const isDraft = status === 'sold' ? false : Boolean(current.is_draft || status === 'draft');
  const { error } = await supabaseServer
    .from('document_projects')
    .update({
      title: preview?.projectType || currentData.preview?.projectType || 'Projeto Inicial',
      client_name: client.name || draft?.fields?.clientName || '',
      contract_number: client.contractNumber || draft?.fields?.contractNum || '',
      address: client.address || draft?.fields?.endereco || '',
      status,
      is_draft: isDraft,
      deleted_at: null,
      deleted_by: null,
      deleted_reason: null,
      deleted_for_users: [],
      restored_at: restoredAt,
      restored_by: actorEmail || primaryAccountEmail,
      updated_by: actorEmail || primaryAccountEmail,
      last_editor_email: actorEmail || primaryAccountEmail,
      last_editor_name: String(actor?.name || 'Admin'),
      data: {
        ...currentData,
        draft,
        preview,
        restoredFrom: candidate.source,
        restoredSourceId: candidate.id || '',
        restoredAt,
        restoredBy: actorEmail || primaryAccountEmail,
      },
    })
    .eq('id', projectId);
  if (error) throw error;

  await persistAuditLog({
    projectId,
    actor,
    action: 'project_restored',
    draft,
    preview,
    settings: null,
    eventId: randomUUID(),
    createdAt: restoredAt,
  });

  return {
    source: candidate.source,
    environments: Array.isArray(draft?.ambientes) ? draft.ambientes.length : (preview?.environments || []).length,
    restoredAt,
  };
}

async function findBestRestoreCandidate(projectId, currentProject) {
  const candidates = [];
  const currentSnapshot = {
    draft: currentProject?.data?.draft || null,
    preview: currentProject?.data?.preview || null,
  };
  addRestoreCandidate(candidates, {
    source: 'current_project',
    id: projectId,
    createdAt: currentProject?.data?.lastEventAt || '',
    snapshot: currentSnapshot,
  });

  const { data: logs, error: logsError } = await supabaseServer
    .from('editor_audit_logs')
    .select('id, event_id, action, payload, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (logsError) throw logsError;
  (logs || []).forEach((log) => {
    const snapshot = restoreSnapshotFromAuditPayload(log.payload);
    addRestoreCandidate(candidates, {
      source: `audit:${log.action || 'editor'}`,
      id: log.id || log.event_id || '',
      createdAt: log.created_at || '',
      snapshot,
    });
  });

  const { data: versions, error: versionsError } = await supabaseServer
    .from('document_html_versions')
    .select('id, html_content, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (versionsError) throw versionsError;
  (versions || []).forEach((version) => {
    const preview = extractPreviewFromHtmlContent(version.html_content || '');
    if (!preview) return;
    addRestoreCandidate(candidates, {
      source: 'html_version',
      id: version.id || '',
      createdAt: version.created_at || '',
      snapshot: {
        draft: draftFromPreview(preview, currentProject?.data?.draft || null),
        preview,
      },
    });
  });

  return candidates
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || dateScore(b.createdAt) - dateScore(a.createdAt))[0] || null;
}

function addRestoreCandidate(candidates, candidate) {
  const snapshot = candidate?.snapshot || {};
  const score = scoreProjectSnapshot(snapshot);
  if (!score) return;
  candidates.push({ ...candidate, score });
}

function dateScore(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function restoreSnapshotFromAuditPayload(payload = {}) {
  const snapshot = payload?.snapshot || {};
  return {
    draft: snapshot.draft || null,
    preview: snapshot.preview || null,
  };
}

function extractPreviewFromHtmlContent(html = '') {
  const match = String(html || '').match(/window\.__DCORATTO_PORTFOLIO_DOCUMENT__\s*=\s*([\s\S]*?);\s*window\.__DCORATTO_CLIENT_VIEW__/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function draftFromPreview(preview, previousDraft = null) {
  if (!Array.isArray(preview?.environments) || !preview.environments.length) return previousDraft || null;
  const ambientes = preview.environments.map((environment, index) => {
    const id = slugify(`${environment.title || 'ambiente'}-${index + 1}`) || `ambiente-${index + 1}`;
    const photos = Array.isArray(environment.photos) && environment.photos.length
      ? environment.photos.map(photo => ({ label: photo.label || photo.title || '', src: photo.src || '' })).filter(photo => photo.src)
      : [];
    return {
      id,
      name: environment.title || `Ambiente ${index + 1}`,
      img: photos[0]?.src || '',
      photos,
      layout: environment.layout || 'balanced',
      pages: Array.isArray(environment.pages) ? environment.pages : [],
    };
  });
  const state = {};
  ambientes.forEach((amb, index) => {
    const environment = preview.environments[index] || {};
    state[amb.id] = {
      tampon: splitSpecValue(environment.specs?.tamponamentos),
      porta: splitSpecValue(environment.specs?.portas),
      puxador: splitSpecValue(environment.specs?.puxadores),
      corredica: splitSpecValue(environment.specs?.corredicas),
      cores: Array.isArray(environment.colors) ? environment.colors : [],
      obs: Array.isArray(environment.notes) ? environment.notes : [],
      obsExtra: '',
    };
  });
  return {
    fields: {
      clientName: preview.client?.name || '',
      contractNum: preview.client?.contractNumber || '',
      endereco: preview.client?.address || '',
      factories: Array.isArray(previousDraft?.fields?.factories) ? previousDraft.fields.factories : [],
    },
    ambientes,
    state,
    updatedAt: new Date().toISOString(),
  };
}

function splitSpecValue(value = '') {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function scoreProjectSnapshot(snapshot = {}) {
  return scoreDraft(snapshot.draft) + scorePreview(snapshot.preview);
}

function scoreDraft(draft = {}) {
  const environments = Array.isArray(draft?.ambientes) ? draft.ambientes : [];
  const stateValues = Object.values(draft?.state || {});
  return environments.reduce((total, environment) => {
    const pages = Array.isArray(environment.pages) ? environment.pages : [];
    const photos = Array.isArray(environment.photos) ? environment.photos : [];
    return total + 10 + photos.length + pages.reduce((pageTotal, page) => {
      const frames = Array.isArray(page.frames) ? page.frames : [];
      const annotations = Array.isArray(page.annotations) ? page.annotations : [];
      const freeElements = Array.isArray(page.freeElements) ? page.freeElements : [];
      return pageTotal + 5 + frames.length * 3 + annotations.length + freeElements.length;
    }, 0);
  }, 0) + stateValues.reduce((total, item) => {
    return total
      + (Array.isArray(item?.cores) ? item.cores.length : 0)
      + (Array.isArray(item?.tampon) ? item.tampon.length : 0)
      + (Array.isArray(item?.porta) ? item.porta.length : 0)
      + (Array.isArray(item?.puxador) ? item.puxador.length : 0)
      + (Array.isArray(item?.corredica) ? item.corredica.length : 0)
      + (Array.isArray(item?.obs) ? item.obs.length : 0)
      + (item?.obsExtra ? 1 : 0);
  }, 0);
}

function scorePreview(preview = {}) {
  const environments = Array.isArray(preview?.environments) ? preview.environments : [];
  return environments.reduce((total, environment) => {
    const pages = Array.isArray(environment.pages) ? environment.pages : [];
    const photos = Array.isArray(environment.photos) ? environment.photos : [];
    const colors = Array.isArray(environment.colors) ? environment.colors : [];
    const notes = Array.isArray(environment.notes) ? environment.notes : [];
    return total + 10 + photos.length + colors.length + notes.length + pages.reduce((pageTotal, page) => {
      const frames = Array.isArray(page.frames) ? page.frames : [];
      const annotations = Array.isArray(page.annotations) ? page.annotations : [];
      const freeElements = Array.isArray(page.freeElements) ? page.freeElements : [];
      return pageTotal + 5 + frames.length * 3 + annotations.length + freeElements.length;
    }, 0);
  }, 0);
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
  const catalogItems = mergeCatalogItemsPayload(tableSettings.catalogItems, payload.catalogItems, { preferIncoming: false });
  return {
    ...payload,
    catalogItems,
    factories: normalizeFactoriesPayload(payload.factories, catalogItems),
    materialOptions: mergeMaterialOptionsPayload(tableSettings.materialOptions, payload.materialOptions),
  };
}

async function saveSharedEditorSettings(incomingSettings, actor = null, settingsMutation = null) {
  const currentSettings = await loadSharedEditorSettings();
  const actorEmail = normalizeEmail(actor?.email);
  const hasIncomingSettings = incomingSettings && Object.keys(incomingSettings).length > 0;
  const protectCatalogCollections = settingsMutation?.type !== 'settings-sync';
  const mergedSettings = hasIncomingSettings
    ? mergeEditorSettingsPayload(currentSettings, incomingSettings, { protectCatalogCollections })
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
      publicUrl: asset.publicUrl || item.publicUrl || '',
      public_url: asset.publicUrl || item.public_url || '',
      storageBucket: asset.storageBucket,
      storagePath: asset.storagePath,
      storage_path: asset.storagePath,
      mimeType: asset.mimeType,
      mime_type: asset.mimeType,
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
  const parsed = await normalizeDataUrlAsset(parseDataUrl(dataUrl));
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

async function normalizeDataUrlAsset(parsed) {
  if (parsed.mimeType === 'image/webp') return parsed;
  const buffer = await sharp(parsed.buffer, { failOn: 'none' })
    .rotate()
    .webp({ quality: 82 })
    .toBuffer();
  return {
    mimeType: 'image/webp',
    buffer,
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

function normalizeFactoryName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeFactoriesPayload(factories = [], catalogItems = []) {
  const values = Array.isArray(factories) ? factories : [];
  const normalized = values
    .map(factory => normalizeFactoryName(typeof factory === 'string' ? factory : factory?.name))
    .filter(Boolean);
  const manufacturers = (Array.isArray(catalogItems) ? catalogItems : [])
    .map(item => normalizeFactoryName(item.manufacturer || item.factory))
    .filter(Boolean);
  return [...new Set([...defaultFactories, ...normalized, ...manufacturers])];
}

function normalizeEditorSettingsPayload(settings = {}) {
  const incomingSettings = settings || {};
  const catalogItems = normalizeCatalogItemsPayload(incomingSettings.catalogItems);
  return {
    ...incomingSettings,
    logo: incomingSettings.logo || '',
    catalogItems,
    factories: normalizeFactoriesPayload(incomingSettings.factories, catalogItems),
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
    factories: Array.isArray(incomingSettings.factories)
      ? normalizeFactoriesPayload(incomingSettings.factories, catalogItems)
      : normalizeFactoriesPayload(currentSettings.factories, catalogItems),
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
  if (mutation.type === 'factory-upsert' && mutation.name) {
    const nextName = normalizeFactoryName(mutation.name);
    const previousName = normalizeFactoryName(mutation.previousName);
    const factories = normalizeFactoriesPayload(payload.factories, payload.catalogItems);
    payload.factories = [...new Set(factories.map(factory => factory === previousName ? nextName : factory).concat(nextName))];
    if (previousName && nextName && previousName !== nextName) {
      const updatedAt = mutation.createdAt || new Date().toISOString();
      payload.catalogItems = normalizeCatalogItemsPayload(payload.catalogItems.map((item) => {
        if (normalizeFactoryName(item.manufacturer || item.factory) !== previousName) return item;
        const catalogKey = stableCatalogKey({
          category: catalogItemGroup(item.type || item.category),
          factory: nextName,
          line: item.line || item.lineName || item.line_name || '',
          quality: item.quality || item.materialType || '',
          name: item.name,
        });
        return {
          ...item,
          factory: nextName,
          manufacturer: nextName,
          catalogKey,
          catalog_key: catalogKey,
          updatedAt,
          updated_at: updatedAt,
          updatedBy: actorEmail || item.updatedBy || item.updated_by || '',
          updated_by: actorEmail || item.updated_by || item.updatedBy || '',
        };
      }));
    }
  }
  if (mutation.type === 'factory-delete' && mutation.name) {
    const name = normalizeFactoryName(mutation.name);
    payload.factories = normalizeFactoriesPayload(payload.factories, []).filter(factory => factory !== name || defaultFactories.includes(factory));
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

function catalogItemUpdatedTimePayload(item = {}) {
  const value = item.updatedAt
    || item.updated_at
    || item.uploadedAt
    || item.createdAt
    || item.created_at
    || item.data?.updatedAt
    || item.data?.updated_at
    || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function isCatalogDataImagePayload(value = '') {
  return String(value || '').startsWith('data:image/');
}

function chooseCatalogImagePayload(existingItem = {}, incomingItem = {}) {
  const existingImage = catalogItemTextureUrlPayload(existingItem);
  const incomingImage = catalogItemTextureUrlPayload(incomingItem);
  if (!existingImage) return incomingImage;
  if (!incomingImage) return existingImage;
  const existingTime = catalogItemUpdatedTimePayload(existingItem);
  const incomingTime = catalogItemUpdatedTimePayload(incomingItem);
  if (existingTime && incomingTime && existingTime > incomingTime) return existingImage;
  if (isCatalogDataImagePayload(existingImage) && (!incomingTime || existingTime >= incomingTime)) return existingImage;
  return incomingImage;
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
  const image = chooseCatalogImagePayload(existingItem, incomingItem);
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
    tamponamento: 'tampon',
    tampon: 'tampon',
    puxador: 'handle',
    porta: 'door',
    corredica: 'slide',
  }[groupKey] || '';
}

async function persistSharedCatalogMutation(settings = {}, mutation = null, actorEmail = '') {
  if (!mutation?.type) return;
  if (mutation.type === 'settings-sync') {
    await persistSharedCatalogTables(settings, actorEmail);
    return;
  }
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
    return;
  }
  if (mutation.type === 'factory-upsert' && mutation.previousName && mutation.name) {
    const previousName = normalizeFactoryName(mutation.previousName);
    const nextName = normalizeFactoryName(mutation.name);
    if (!previousName || !nextName || previousName === nextName) return;
    await persistSharedCatalogTables(settings, actorEmail);
    await softDeleteSharedCatalogItemsByManufacturer(previousName, actorEmail, 'factory_renamed');
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
  const textureUrl = catalogItemTextureUrlPayload(item);
  const publicImageUrl = [
    item.textureUrl,
    item.imageUrl,
    item.texture_url,
    item.image_url,
    item.publicUrl,
    item.public_url,
  ].map(value => String(value || '').trim())
    .find(value => value && !value.startsWith('data:image/') && (value.startsWith('http') || value.startsWith('/'))) || null;
  const rowData = {
    ...item,
    catalogKey,
    textureUrl: publicImageUrl || textureUrl || '',
    imageUrl: publicImageUrl || textureUrl || '',
    publicUrl: publicImageUrl || item.publicUrl || item.public_url || '',
    public_url: publicImageUrl || item.public_url || item.publicUrl || '',
  };
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
    texture_url: textureUrl || null,
    image_data: null,
    image_url: publicImageUrl,
    storage_bucket: item.storageBucket || photoBucket,
    storage_path: item.storagePath || null,
    public_url: publicImageUrl,
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
    data: rowData,
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

async function softDeleteSharedCatalogItemsByManufacturer(manufacturer, actorEmail = '', reason = 'factory_renamed') {
  if (!manufacturer) return;
  const { error } = await supabaseServer
    .from('catalog_materials')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: actorEmail || primaryAccountEmail,
      deleted_reason: reason,
      updated_by: actorEmail || primaryAccountEmail,
    })
    .eq('manufacturer', manufacturer);
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
  const catalogGroups = [...new Set(['color', 'tamponamento', 'puxador', 'porta', 'corredica', ...catalogItems.map(item => catalogItemGroup(item.type)).filter(Boolean)])];
  const optionGroups = [...new Set(['tampon', 'porta', 'puxador', 'corredica', ...Object.keys(materialOptions || {})])];

  const materialRows = catalogItems
    .filter(item => item?.name)
    .map((item, index) => catalogMaterialRowFromItem(item, index, actorEmail));

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
    tampon: 'tamponamento',
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
    tampon: 'tampon',
    handle: 'puxador',
    door: 'porta',
    slide: 'corredica',
  }[type] || '';
}

function hasPersistableContent(draft, preview) {
  const hasPreviewContent = Array.isArray(preview?.environments) && preview.environments.length > 0;
  const hasAmbientes = Array.isArray(draft?.ambientes) && draft.ambientes.length > 0;
  const hasFields = Object.entries(draft?.fields || {}).some(([key, value]) => {
    if (key === 'factories') return false;
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
  let client = preview.client || {};
  const actorEmail = normalizeEmail(actor?.email);
  let projectFactories = Array.isArray(client.manufacturers) && client.manufacturers.length
    ? client.manufacturers
    : (Array.isArray(draft?.fields?.factories) ? draft.fields.factories : []);
  const existingProject = await loadProjectForWrite(projectId);
  if (existingProject?.status === 'sold') {
    throw new Error('Projeto vendido esta bloqueado para alteracoes.');
  }
  if (existingProject && !canAccessPrivateProject(existingProject, actorEmail)) {
    throw new Error('forbidden_project_access');
  }
  const protectedDocument = protectAgainstImplicitContentLoss({
    existingProject,
    action: 'generate_project_initial',
    draft,
    preview,
  });
  draft = protectedDocument.draft;
  preview = protectedDocument.preview;
  client = preview?.client || client || {};
  projectFactories = Array.isArray(client.manufacturers) && client.manufacturers.length
    ? client.manufacturers
    : (Array.isArray(draft?.fields?.factories) ? draft.fields.factories : projectFactories);
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
      factory: projectFactories.join(' + '),
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
      mobileFirst: true,
      mobileLayoutVersion: clientMobileFirstVersion,
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
  const template = await readPortfolioTemplate();
  if (!template) throw new Error('Template portfolio_document.html nao encontrado para gerar o link do cliente.');
  const serialized = JSON.stringify(sanitizeClientPreview(preview))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const hardening = `
    <meta name="robots" content="noindex,nofollow,noarchive">
    <meta name="referrer" content="no-referrer">
    <meta name="dcoratto-client-layout" content="mobile-first">
    <script>
      window.__DCORATTO_CLIENT_MOBILE_FIRST__ = ${JSON.stringify(clientMobileFirstVersion)};
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
  const html = template.replace('</head>', `${hardening}</head>`);
  return html.replace('<body>', `<body data-dcoratto-mobile-first="${clientMobileFirstVersion}">`);
}

function sanitizeClientPreview(preview = {}) {
  const {
    manufacturer,
    manufacturers,
    factory,
    factories,
    ...client
  } = preview.client || {};
  return {
    ...preview,
    client: {
      ...client,
      manufacturers: [],
    },
    environments: (Array.isArray(preview.environments) ? preview.environments : []).map((environment) => ({
      ...environment,
      colors: (Array.isArray(environment.colors) ? environment.colors : []).map(clientVisibleColorPayload),
    })),
  };
}

function clientVisibleColorPayload(color = {}) {
  return {
    name: color.displayName || color.name || '',
    hex: color.hex || '',
    textureUrl: color.textureUrl || color.imageUrl || '',
    quality: color.quality || '',
  };
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

function publicAppUser(user = {}) {
  const normalized = normalizeAppUser(user);
  return {
    email: normalized.email,
    name: normalized.name,
    role: normalized.role,
    active: user.active !== false,
    isPrimary: normalized.email === primaryAccountEmail,
    updatedAt: user.updated_at || user.updatedAt || null,
    createdAt: user.created_at || user.createdAt || null,
  };
}

function sortAppUsers(a, b) {
  if (a.email === primaryAccountEmail) return -1;
  if (b.email === primaryAccountEmail) return 1;
  return String(a.name || a.email).localeCompare(String(b.name || b.email), 'pt-BR');
}

function canManageAppUsers(actorEmail) {
  return isAdminEmail(actorEmail);
}

async function canRestoreProjects(actorEmail) {
  const email = normalizeEmail(actorEmail);
  if (isAdminEmail(email)) return true;
  if (!email || !supabaseServer) return false;
  const { data, error } = await supabaseServer
    .from('app_users')
    .select('role, active')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data?.active !== false && ['owner', 'admin'].includes(String(data?.role || '').toLowerCase());
}

function normalizeAppUserRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return ['owner', 'admin', 'team'].includes(normalizedRole) ? normalizedRole : 'team';
}

function validateAppUserInput({ email, name, password, isNew }) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Informe um login de email valido.';
  if (!name) return 'Informe o nome do funcionario.';
  if (isNew && !password) return 'Informe uma senha para o novo funcionario.';
  if (password && password.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  return '';
}

function upsertRuntimeLoginUser({ originalEmail, email, name, role, password }) {
  const existingIndex = runtimeLoginUsers.findIndex(user => user.email === (originalEmail || email));
  const existingUser = existingIndex >= 0 ? runtimeLoginUsers[existingIndex] : null;
  const nextUser = {
    ...(existingUser || {}),
    email,
    name,
    role: email === primaryAccountEmail ? 'owner' : role,
    password: password || existingUser?.password || '',
    active: true,
  };
  if (existingIndex >= 0) runtimeLoginUsers.splice(existingIndex, 1, nextUser);
  else runtimeLoginUsers.push(nextUser);
  return nextUser;
}

function normalizeAppUserError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('password_required')) return 'Informe uma senha para o novo funcionario.';
  if (message.includes('primary_user_locked')) return 'A conta principal nao pode ter o login alterado.';
  if (message.includes('duplicate key')) return 'Ja existe um funcionario com este login.';
  if (message.includes('invalid_app_user')) return 'Revise nome, login e senha do funcionario.';
  if (message.includes('forbidden')) return 'Apenas a conta principal pode gerenciar funcionarios.';
  return message || 'Nao foi possivel salvar o funcionario.';
}

function designerNameFromEmail(email = '') {
  const normalizedEmail = normalizeEmail(email);
  const knownUser = runtimeLoginUsers.find(user => user.email === normalizedEmail);
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
