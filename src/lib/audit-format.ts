export function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    "category.create": "Departamento criado",
    "category.update": "Departamento atualizado",
    "category.delete": "Departamento excluído",
    "category.deactivate": "Departamento desativado",
    "category.reactivate": "Departamento reativado",
    "category.move_to_trash": "Pasta movida para a lixeira",
    "category.restore_from_trash": "Pasta restaurada da lixeira",
    "category.permanent_delete": "Pasta excluída definitivamente",
    "category.move": "Pasta movida",
    "announcement.create": "Comunicado criado",
    "announcement.update": "Comunicado atualizado",
    "announcement.publish": "Comunicado publicado",
    "announcement.archive": "Comunicado arquivado",
    "announcement.reactivate": "Comunicado reativado",
    "announcement.move_to_trash": "Comunicado movido para a lixeira",
    "announcement.restore_from_trash": "Comunicado restaurado da lixeira",
    "announcement.permanent_delete": "Comunicado excluído definitivamente",
    "document.create": "Documento criado",
    "document.update": "Documento atualizado",
    "document.publish": "Documento publicado",
    "document.archive": "Documento arquivado",
    "document.move_to_trash": "Documento movido para a lixeira",
    "document.restore_from_trash": "Documento restaurado da lixeira",
    "document.permanent_delete": "Documento excluído definitivamente",
    "document.move": "Documento movido",
    "folder_link.move_to_trash": "Link movido para a lixeira",
    "folder_link.restore_from_trash": "Link restaurado da lixeira",
    "folder_link.permanent_delete": "Link excluído definitivamente",
    "folder_link.move": "Link movido",
    "shared_link.create": "Link compartilhavel criado",
    "shared_link.revoke": "Link compartilhavel revogado",
    "attachment.restore_from_trash": "Anexo restaurado da lixeira",
    "attachment.permanent_delete": "Anexo excluído definitivamente",
    "document_version.restore_from_trash": "Versão restaurada da lixeira",
    "document_version.permanent_delete": "Versão excluída definitivamente",
    "user.create": "Colaborador criado",
    "user.create_viewer": "Colaborador criado",
    "user.update": "Colaborador atualizado",
    "user.activate": "Colaborador ativado",
    "user.deactivate": "Colaborador desativado",
    "user.password_reset": "Senha redefinida",
    "user.reset_password": "Senha redefinida",
    "user.promote_admin": "Usuário promovido a administrador",
    "user.demote_viewer": "Administrador alterado para colaborador",
    "onboarding.create": "Onboarding criado",
    "onboarding.update": "Onboarding atualizado",
    "engagement.mark_viewed": "Visualização marcada pelo administrador"
  };

  return labels[action] ?? humanizeToken(action);
}

export function formatEntityType(entityType: string) {
  const labels: Record<string, string> = {
    category: "Departamentos",
    document: "Documentos",
    announcement: "Comunicados",
    folder_link: "Links",
    attachment: "Anexos",
    document_file_version: "Versões de documentos",
    profile: "Colaboradores",
    user: "Colaboradores",
    onboarding: "Onboarding",
    engagement: "Engajamento"
  };

  return labels[entityType] ?? humanizeToken(entityType);
}

export function formatAuditMetadata(metadata: Record<string, unknown>) {
  const name = typeof metadata.name === "string" ? metadata.name : null;
  const title = typeof metadata.title === "string" ? metadata.title : null;
  const username = typeof metadata.username === "string" ? metadata.username : null;
  const department = typeof metadata.department === "string" ? metadata.department : null;
  const accessScope = typeof metadata.accessScope === "string" ? metadata.accessScope : null;
  const targetName = typeof metadata.targetName === "string" ? metadata.targetName : null;
  const previousRole = typeof metadata.previousRole === "string" ? metadata.previousRole : null;
  const newRole = typeof metadata.newRole === "string" ? metadata.newRole : null;
  const pieces: string[] = [];

  if (name) {
    pieces.push(`Item: ${name}`);
  }

  if (!name && title) {
    pieces.push(`Item: ${title}`);
  }

  if (username) {
    pieces.push(`Login: ${username}`);
  }

  if (department) {
    pieces.push(`Departamento: ${department}`);
  }

  if (accessScope) {
    pieces.push(`Escopo: ${accessScope === "global" ? "Global" : "Departamento"}`);
  }

  if (targetName) {
    pieces.push(`Destino: ${targetName}`);
  }

  if (previousRole && newRole) {
    pieces.push(`Papel: ${roleLabel(previousRole)} para ${roleLabel(newRole)}`);
  }

  return pieces.length > 0 ? pieces.join(" · ") : "Sem detalhes adicionais.";
}

function roleLabel(value: string) {
  return value === "admin" ? "Administrador" : value === "viewer" ? "Colaborador" : value;
}

function humanizeToken(value: string) {
  return value
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
