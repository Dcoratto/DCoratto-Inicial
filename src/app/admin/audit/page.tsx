import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatAuditAction, formatAuditMetadata, formatEntityType } from "@/lib/audit-format";

type AuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export default async function AdminAuditPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("id,actor_id,action,entity_type,entity_id,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const logs = (data ?? []) as AuditLog[];
  const actorIds = unique(logs.map((log) => log.actor_id));
  const categoryIds = unique(logs.filter((log) => log.entity_type === "category").map((log) => log.entity_id));
  const documentIds = unique(logs.filter((log) => log.entity_type === "document").map((log) => log.entity_id));
  const announcementIds = unique(logs.filter((log) => log.entity_type === "announcement").map((log) => log.entity_id));
  const profileIds = unique(logs.filter((log) => log.entity_type === "profile" || log.entity_type === "user").map((log) => log.entity_id));

  const [actors, categories, documents, announcements, profiles] = await Promise.all([
    actorIds.length > 0 ? supabase.from("profiles").select("id,username,email,full_name").in("id", actorIds) : emptyResult(),
    categoryIds.length > 0 ? supabase.from("categories").select("id,name").in("id", categoryIds) : emptyResult(),
    documentIds.length > 0 ? supabase.from("documents").select("id,title").in("id", documentIds) : emptyResult(),
    announcementIds.length > 0 ? supabase.from("announcements").select("id,title").in("id", announcementIds) : emptyResult(),
    profileIds.length > 0 ? supabase.from("profiles").select("id,username,email,full_name").in("id", profileIds) : emptyResult()
  ]);

  const actorNames = toNameMap(actors.data as NamedRow[] | null);
  const itemNames = new Map<string, string>();
  addNameRows(itemNames, categories.data as NamedRow[] | null, "name");
  addNameRows(itemNames, documents.data as NamedRow[] | null, "title");
  addNameRows(itemNames, announcements.data as NamedRow[] | null, "title");
  addProfileRows(itemNames, profiles.data as ProfileRow[] | null);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-semibold text-decorato-ink">Auditoria</h1>
        <p className="mt-1 text-decorato-muted">Eventos administrativos recentes.</p>
      </header>
      <div className="overflow-hidden rounded-lg border border-decorato-line bg-white">
        <table className="min-w-full divide-y divide-decorato-line text-sm">
          <thead className="bg-decorato-paper text-left text-decorato-muted">
            <tr>
              <th className="px-4 py-3 font-normal">Quando</th>
              <th className="px-4 py-3 font-normal">Quem fez</th>
              <th className="px-4 py-3 font-normal">Ação</th>
              <th className="px-4 py-3 font-normal">Área</th>
              <th className="px-4 py-3 font-normal">Item</th>
              <th className="px-4 py-3 font-normal">Resumo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-decorato-line">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3">{new Date(log.created_at).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">{log.actor_id ? actorNames.get(log.actor_id) ?? "Usuário removido" : "Sistema"}</td>
                <td className="px-4 py-3">{formatAuditAction(log.action)}</td>
                <td className="px-4 py-3">{formatEntityType(log.entity_type)}</td>
                <td className="px-4 py-3">{log.entity_id ? itemNames.get(log.entity_id) ?? log.entity_id.slice(0, 8) : "-"}</td>
                <td className="px-4 py-3 text-decorato-muted">
                  <p>{formatAuditMetadata(log.metadata)}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-decorato-teal">Ver detalhes técnicos</summary>
                    <pre className="mt-2 max-w-sm overflow-x-auto rounded-md bg-decorato-paper p-2 text-xs">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type NamedRow = {
  id: string;
  name?: string | null;
  title?: string | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  email: string | null;
  full_name: string | null;
};

function unique(values: Array<string | null>) {
  return [...new Set(values.filter(Boolean) as string[])];
}

function emptyResult() {
  return Promise.resolve({ data: [] });
}

function toNameMap(rows: NamedRow[] | ProfileRow[] | null) {
  const map = new Map<string, string>();
  (rows ?? []).forEach((row) => {
    if ("full_name" in row) {
      map.set(row.id, row.full_name || row.username || row.email || row.id.slice(0, 8));
    } else {
      map.set(row.id, row.name || row.title || row.id.slice(0, 8));
    }
  });
  return map;
}

function addNameRows(map: Map<string, string>, rows: NamedRow[] | null, key: "name" | "title") {
  (rows ?? []).forEach((row) => {
    map.set(row.id, row[key] || row.id.slice(0, 8));
  });
}

function addProfileRows(map: Map<string, string>, rows: ProfileRow[] | null) {
  (rows ?? []).forEach((row) => {
    map.set(row.id, row.full_name || row.username || row.email || row.id.slice(0, 8));
  });
}
