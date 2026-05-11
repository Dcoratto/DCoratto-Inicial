import { isSupabaseConfigured, supabase } from './supabaseClient';

const STORAGE_KEY = 'dcoratto.document.autosave.v1';

export function loadLocalDocument(fallbackDocument) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : fallbackDocument;
  } catch {
    return fallbackDocument;
  }
}

export function saveLocalDocument(documentData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(documentData));
}

export async function loadCatalogs(fallbackColors, fallbackOptions) {
  if (!isSupabaseConfigured) {
    return { colors: fallbackColors, options: fallbackOptions, source: 'local' };
  }

  const [{ data: colors, error: colorError }, { data: options, error: optionError }] = await Promise.all([
    supabase.from('catalog_colors').select('name, hex').eq('active', true).order('sort_order'),
    supabase.from('catalog_options').select('group_key, label').eq('active', true).order('sort_order'),
  ]);

  if (colorError || optionError) {
    console.warn('Falha ao carregar catalogos do Supabase', colorError || optionError);
    return { colors: fallbackColors, options: fallbackOptions, source: 'local' };
  }

  return {
    colors: colors.map((color) => ({ name: color.name, hex: color.hex })),
    options: options.reduce((acc, option) => {
      acc[option.group_key] = [...(acc[option.group_key] ?? []), option.label];
      return acc;
    }, {}),
    source: 'supabase',
  };
}

export async function loadProject(projectId, fallbackDocument) {
  if (!isSupabaseConfigured || !projectId) {
    return { document: loadLocalDocument(fallbackDocument), source: 'local' };
  }

  const { data: project, error: projectError } = await supabase
    .from('document_projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (projectError) {
    console.warn('Falha ao carregar projeto do Supabase', projectError);
    return { document: loadLocalDocument(fallbackDocument), source: 'local' };
  }

  const { data: environments, error: environmentsError } = await supabase
    .from('document_environments')
    .select('*')
    .eq('project_id', projectId)
    .order('position');

  if (environmentsError) {
    console.warn('Falha ao carregar ambientes do Supabase', environmentsError);
  }

  return {
    document: fromDatabase(project, environments ?? []),
    source: 'supabase',
  };
}

export async function saveProject(documentData) {
  saveLocalDocument(documentData);

  if (!isSupabaseConfigured) {
    return { source: 'local', projectId: documentData.id ?? null };
  }

  const projectPayload = {
    id: documentData.id || undefined,
    title: 'Projeto Inicial',
    client_name: documentData.clientName,
    contract_number: documentData.contractNumber,
    factory: documentData.factory,
    address: documentData.address,
    project_code: documentData.projectCode,
    data: {
      date: documentData.date,
      documentType: 'projeto_inicial',
    },
  };

  const { data: project, error: projectError } = await supabase
    .from('document_projects')
    .upsert(projectPayload)
    .select('id')
    .single();

  if (projectError) throw projectError;

  const projectId = project.id;

  const environmentPayloads = documentData.environments.map((environment, index) => ({
    id: environment.id,
    project_id: projectId,
    position: index,
    name: environment.name,
    subtitle: environment.subtitle,
    image_data: environment.image?.startsWith('data:') ? environment.image : null,
    image_url: environment.image?.startsWith('http') ? environment.image : null,
    colors: environment.colors,
    tamponamentos: environment.tamponamentos,
    portas: environment.portas,
    puxadores: environment.puxadores,
    notes: environment.notes,
    free_note: environment.freeNote,
    data: {},
  }));

  const { error: environmentError } = await supabase
    .from('document_environments')
    .upsert(environmentPayloads);

  if (environmentError) throw environmentError;

  const keepIds = environmentPayloads.map((environment) => environment.id);
  if (keepIds.length) {
    const { error: deleteError } = await supabase
      .from('document_environments')
      .delete()
      .eq('project_id', projectId)
      .not('id', 'in', `(${keepIds.join(',')})`);

    if (deleteError) throw deleteError;
  }

  await supabase.from('document_versions').insert({
    project_id: projectId,
    snapshot: { ...documentData, id: projectId },
    reason: 'autosave',
  });

  return { source: 'supabase', projectId };
}

function fromDatabase(project, environments) {
  return {
    id: project.id,
    clientName: project.client_name,
    contractNumber: project.contract_number,
    factory: project.factory,
    address: project.address,
    projectCode: project.project_code,
    date: project.data?.date ?? new Date(project.updated_at).toLocaleDateString('pt-BR'),
    environments: environments.map((environment) => ({
      id: environment.id,
      name: environment.name,
      subtitle: environment.subtitle,
      image: environment.image_data || environment.image_url || '',
      colors: environment.colors ?? [],
      tamponamentos: environment.tamponamentos ?? '',
      portas: environment.portas ?? '',
      puxadores: environment.puxadores ?? '',
      notes: environment.notes ?? [],
      freeNote: environment.free_note ?? '',
    })),
  };
}
