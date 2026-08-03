import { Clock, Eye, MousePointerClick, Users } from "lucide-react";
import { markEngagementViewedByAdmin } from "@/actions/engagement";
import { EngagementDashboardCharts, type ChartDatum } from "@/components/engagement-dashboard-charts";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Category, ContentAudienceReceipt, EngagementContentType, Profile } from "@/types/app";

type PageProps = {
  searchParams?: Promise<{
    period?: string;
    department?: string;
    user?: string;
    type?: string;
    viewed?: string;
    content?: string;
    sort?: string;
    page?: string;
  }>;
};

type RawEvent = {
  user_id: string;
  created_at: string;
  department_category_id: string | null;
  content_type: EngagementContentType;
};

const contentTypeOptions: Array<{ value: EngagementContentType | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "document", label: "Documento" },
  { value: "announcement", label: "Comunicado" },
  { value: "popup", label: "Popup" },
  { value: "banner", label: "Banner" },
  { value: "onboarding", label: "Onboarding" },
  { value: "folder_link", label: "Link de pasta" },
  { value: "attachment", label: "Arquivo" },
  { value: "document_version", label: "Versao de documento" }
];

export default async function EngagementDashboardPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const period = [7, 30, 90].includes(Number(params.period)) ? Number(params.period) : 30;
  const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();
  const selectedDepartment = params.department && params.department !== "all" ? params.department : null;
  const selectedUser = params.user && params.user !== "all" ? params.user : null;
  const selectedType = isContentType(params.type) ? params.type : null;
  const selectedViewed =
    params.viewed === "viewed" || params.viewed === "not_opened" || params.viewed === "opened_not_viewed"
      ? params.viewed
      : "all";
  const contentFilter = (params.content ?? "").trim().toLowerCase();
  const sort = params.sort === "time" ? "time" : "last";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 50;
  const supabase = await createSupabaseServerClient();

  let receiptsQuery = supabase
    .from("content_audience_receipts")
    .select(
      "id,user_id,content_type,content_id,category_id,assigned_department_category_id,assigned_by,assigned_reason,required,open_count,total_active_seconds,average_session_seconds,expected_seconds,video_completed_count,max_video_percent_watched,attention_status,first_opened_at,last_opened_at,is_viewed,viewed_at,viewed_source,last_event_at,created_at,updated_at"
    )
    .gte("created_at", since)
    .order("updated_at", { ascending: false })
    .limit(1000);

  let eventsQuery = supabase
    .from("content_view_events")
    .select("user_id,created_at,department_category_id,content_type")
    .eq("event_type", "open")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (selectedDepartment) {
    receiptsQuery = receiptsQuery.eq("assigned_department_category_id", selectedDepartment);
    eventsQuery = eventsQuery.eq("department_category_id", selectedDepartment);
  }

  if (selectedUser) {
    receiptsQuery = receiptsQuery.eq("user_id", selectedUser);
    eventsQuery = eventsQuery.eq("user_id", selectedUser);
  }

  if (selectedType) {
    receiptsQuery = receiptsQuery.eq("content_type", selectedType);
    eventsQuery = eventsQuery.eq("content_type", selectedType);
  }

  if (selectedViewed === "viewed") {
    receiptsQuery = receiptsQuery.eq("is_viewed", true);
  }

  if (selectedViewed === "not_opened") {
    receiptsQuery = receiptsQuery.eq("open_count", 0);
  }

  if (selectedViewed === "opened_not_viewed") {
    receiptsQuery = receiptsQuery.gt("open_count", 0).eq("is_viewed", false);
  }

  const [
    { data: receiptsData },
    { data: eventsData },
    { data: profilesData },
    { data: categoriesData },
    { data: documentsData },
    { data: announcementsData },
    { data: onboardingData },
    { data: folderLinksData },
    { data: attachmentsData },
    { data: fileVersionsData }
  ] = await Promise.all([
    receiptsQuery,
    eventsQuery,
    supabase
      .from("profiles")
      .select("id,username,email,full_name,role,department,department_id,department_category_id,is_active,must_change_password")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(1000),
    supabase
      .from("categories")
      .select("id,parent_id,name,slug,description,sort_order,is_active,is_department,access_scope")
      .eq("is_active", true)
      .eq("is_department", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("documents").select("id,title").limit(1000),
    supabase.from("announcements").select("id,title").limit(1000),
    supabase.from("onboarding_items").select("id,title").limit(1000),
    supabase.from("folder_links").select("id,title").limit(1000),
    supabase.from("attachments").select("id,original_name").limit(1000),
    supabase.from("document_file_versions").select("id,original_name,version_number").limit(1000)
  ]);

  const receipts = (receiptsData ?? []) as ContentAudienceReceipt[];
  const events = (eventsData ?? []) as RawEvent[];
  const profiles = (profilesData ?? []) as Profile[];
  const departments = (categoriesData ?? []) as Category[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const contentTitles = buildContentTitleMap(
    documentsData as Array<{ id: string; title: string }> | null,
    announcementsData as Array<{ id: string; title: string }> | null,
    onboardingData as Array<{ id: string; title: string }> | null,
    folderLinksData as Array<{ id: string; title: string }> | null,
    attachmentsData as Array<{ id: string; original_name: string }> | null,
    fileVersionsData as Array<{ id: string; original_name: string; version_number: number }> | null
  );
  const activeUserIds = new Set(receipts.filter((receipt) => receipt.open_count > 0).map((receipt) => receipt.user_id));
  const filteredProfiles = profiles.filter((profile) => {
    if (selectedDepartment && profile.department_category_id !== selectedDepartment) {
      return false;
    }
    if (selectedUser && profile.id !== selectedUser) {
      return false;
    }
    return true;
  });
  const rowsAfterContentFilter = receipts.filter((receipt) =>
    contentFilter ? contentTitle(receipt, contentTitles).toLowerCase().includes(contentFilter) : true
  );
  const sortedRows = [...rowsAfterContentFilter].sort((a, b) => {
    if (sort === "time") {
      return b.total_active_seconds - a.total_active_seconds;
    }
    return new Date(b.last_opened_at ?? b.last_event_at ?? b.updated_at).getTime() - new Date(a.last_opened_at ?? a.last_event_at ?? a.updated_at).getTime();
  });
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const tableRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  const totalExpected = receipts.length;
  const totalOpens = sum(receipts, "open_count");
  const totalSeconds = sum(receipts, "total_active_seconds");
  const activeUsers = activeUserIds.size;
  const inactiveUsers = new Set(receipts.filter((receipt) => receipt.open_count === 0).map((receipt) => receipt.user_id)).size;
  const viewedCount = receipts.filter((receipt) => receipt.is_viewed).length;
  const notViewedCount = Math.max(totalExpected - viewedCount, 0);
  const ignoredContent = new Set(receipts.filter((receipt) => receipt.open_count === 0).map((receipt) => receipt.content_id)).size;
  const viewedRate = totalExpected > 0 ? Math.round((viewedCount / totalExpected) * 100) : 0;
  const averageSecondsPerPerson = filteredProfiles.length > 0 ? Math.round(totalSeconds / filteredProfiles.length) : 0;
  const averageSecondsPerContent = totalExpected > 0 ? Math.round(totalSeconds / totalExpected) : 0;
  const expectedReceipts = receipts.filter((receipt) => Number(receipt.expected_seconds ?? 0) > 0);
  const averageExpectedSeconds =
    expectedReceipts.length > 0 ? Math.round(sumExpectedSeconds(expectedReceipts) / expectedReceipts.length) : 0;
  const belowExpectedReceipts = receipts.filter((receipt) => attentionStatus(receipt) === "low_attention").length;
  const averageAttention =
    expectedReceipts.length > 0
      ? Math.round(
          expectedReceipts.reduce((total, receipt) => {
            const expected = Math.max(1, Number(receipt.expected_seconds ?? 0));
            return total + Math.min(100, Math.round((receipt.total_active_seconds / expected) * 100));
          }, 0) / expectedReceipts.length
        )
      : 0;
  const completedVideos = sumOptional(receipts, "video_completed_count");
  const notCompletedVideos = receipts.filter(
    (receipt) => Number(receipt.max_video_percent_watched ?? 0) > 0 && Number(receipt.video_completed_count ?? 0) === 0
  ).length;

  const charts = buildCharts(receipts, events, filteredProfiles, profileById, departmentById, contentTitles, activeUserIds);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-decorato-ink">Engajamento</h1>
          <p className="mt-2 text-decorato-muted">
            Veja quais profissionais estão se inteirando dos comunicados, documentos e trilhas por departamento.
          </p>
        </div>
        <form className="grid gap-2 rounded-lg border border-decorato-line bg-white p-3 sm:grid-cols-3 xl:grid-cols-6">
          <Select name="period" label="Período" defaultValue={String(period)}>
            <option value="7">7 dias</option>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
          </Select>
          <Select name="department" label="Departamento" defaultValue={selectedDepartment ?? "all"}>
            <option value="all">Todos</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
          <Select name="user" label="Colaborador" defaultValue={selectedUser ?? "all"}>
            <option value="all">Todos</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {displayUser(profile)}
              </option>
            ))}
          </Select>
          <Select name="type" label="Tipo" defaultValue={selectedType ?? "all"}>
            {contentTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select name="viewed" label="Visualizado" defaultValue={selectedViewed}>
            <option value="all">Todos</option>
            <option value="viewed">Visualizados</option>
            <option value="opened_not_viewed">Abriu, não marcou</option>
            <option value="not_opened">Não abriu</option>
          </Select>
          <Select name="sort" label="Ordenar" defaultValue={sort}>
            <option value="last">Última visualização</option>
            <option value="time">Tempo total</option>
          </Select>
          <label className="block sm:col-span-3 xl:col-span-5">
            <span className="text-xs text-decorato-muted">Conteúdo</span>
            <input
              name="content"
              defaultValue={params.content ?? ""}
              placeholder="Filtrar pelo título"
              className="mt-1 h-10 w-full rounded-md border border-decorato-line px-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
            />
          </label>
          <button className="rounded-md bg-decorato-teal px-3 py-2 text-sm font-semibold text-white" type="submit">
            Aplicar
          </button>
        </form>
      </header>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard icon={<Eye aria-hidden="true" size={18} />} label="Conteúdos esperados" value={totalExpected} />
        <MetricCard icon={<Eye aria-hidden="true" size={18} />} label="Total de visualizações" value={totalOpens} />
        <MetricCard icon={<Users aria-hidden="true" size={18} />} label="Pessoas ativas" value={activeUsers} />
        <MetricCard icon={<Users aria-hidden="true" size={18} />} label="Pessoas sem leitura" value={inactiveUsers} />
        <MetricCard icon={<Clock aria-hidden="true" size={18} />} label="Tempo total" value={formatDuration(totalSeconds)} />
        <MetricCard icon={<Clock aria-hidden="true" size={18} />} label="Média por pessoa" value={formatDuration(averageSecondsPerPerson)} />
        <MetricCard icon={<Clock aria-hidden="true" size={18} />} label="Média por conteúdo" value={formatDuration(averageSecondsPerContent)} />
        <MetricCard icon={<Clock aria-hidden="true" size={18} />} label="Tempo esperado médio" value={formatDuration(averageExpectedSeconds)} />
        <MetricCard icon={<MousePointerClick aria-hidden="true" size={18} />} label="Atenção média" value={`${averageAttention}%`} />
        <MetricCard icon={<MousePointerClick aria-hidden="true" size={18} />} label="Abaixo do esperado" value={belowExpectedReceipts} />
        <MetricCard icon={<MousePointerClick aria-hidden="true" size={18} />} label="Vídeos concluídos" value={completedVideos} />
        <MetricCard icon={<MousePointerClick aria-hidden="true" size={18} />} label="Vídeos não concluídos" value={notCompletedVideos} />
        <MetricCard icon={<MousePointerClick aria-hidden="true" size={18} />} label="Taxa de visualização" value={`${viewedRate}%`} />
        <MetricCard icon={<MousePointerClick aria-hidden="true" size={18} />} label="Não visualizados" value={notViewedCount} />
        <MetricCard icon={<MousePointerClick aria-hidden="true" size={18} />} label="Conteúdos ignorados" value={ignoredContent} />
      </section>

      <EngagementDashboardCharts {...charts} />

      <section className="overflow-hidden rounded-lg border border-decorato-line bg-white">
        <div className="border-b border-decorato-line p-4">
          <h2 className="text-xl font-semibold text-decorato-ink">Controle real de visualizacao</h2>
          <p className="mt-1 text-sm text-decorato-muted">
            Mostra quem deveria ver, quem abriu, quanto tempo ficou e quem ainda não visualizou.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-decorato-line text-sm">
            <thead className="bg-decorato-paper text-left text-decorato-muted">
              <tr>
                <th className="px-4 py-3 font-normal">Departamento</th>
                <th className="px-4 py-3 font-normal">Profissional</th>
                <th className="px-4 py-3 font-normal">Conteúdo</th>
                <th className="px-4 py-3 font-normal">Tipo</th>
                <th className="px-4 py-3 font-normal">Aberturas</th>
                <th className="px-4 py-3 font-normal">Tempo esperado</th>
                <th className="px-4 py-3 font-normal">Tempo total</th>
                <th className="px-4 py-3 font-normal">Média</th>
                <th className="px-4 py-3 font-normal">% atenção</th>
                <th className="px-4 py-3 font-normal">Primeira visualização</th>
                <th className="px-4 py-3 font-normal">Última visualização</th>
                <th className="px-4 py-3 font-normal">Marcado em</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 font-normal">Origem</th>
                <th className="px-4 py-3 font-normal">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-decorato-line">
              {tableRows.map((receipt) => {
                const profile = profileById.get(receipt.user_id);
                const statusClass = receipt.is_viewed
                  ? "bg-decorato-teal/10 text-decorato-teal"
                  : receipt.open_count > 0
                    ? "bg-decorato-sun/25 text-decorato-ink"
                    : "bg-decorato-coral/10 text-decorato-coral";
                return (
                  <tr key={receipt.id}>
                    <td className="px-4 py-3">{departmentName(departmentIdForReceipt(receipt, profile), departmentById)}</td>
                    <td className="px-4 py-3">{profile ? displayUser(profile) : receipt.user_id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{contentTitle(receipt, contentTitles)}</td>
                    <td className="px-4 py-3">{contentTypeLabel(receipt.content_type)}</td>
                    <td className="px-4 py-3">{receipt.open_count}</td>
                    <td className="px-4 py-3">{formatDuration(Number(receipt.expected_seconds ?? 0))}</td>
                    <td className="px-4 py-3">{formatDuration(receipt.total_active_seconds)}</td>
                    <td className="px-4 py-3">{formatDuration(Math.round(Number(receipt.average_session_seconds ?? 0)))}</td>
                    <td className="px-4 py-3">{attentionPercent(receipt)}%</td>
                    <td className="px-4 py-3">{formatDateTime(receipt.first_opened_at)}</td>
                    <td className="px-4 py-3">{formatDateTime(receipt.last_opened_at)}</td>
                    <td className="px-4 py-3">{formatDateTime(receipt.viewed_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${statusClass}`}>
                        {attentionLabel(receipt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{viewedSourceLabel(receipt.viewed_source)}</td>
                    <td className="px-4 py-3">
                      {!receipt.is_viewed ? (
                        <form action={markEngagementViewedByAdmin}>
                          <input type="hidden" name="userId" value={receipt.user_id} />
                          <input type="hidden" name="contentType" value={receipt.content_type} />
                          <input type="hidden" name="contentId" value={receipt.content_id} />
                          <input type="hidden" name="categoryId" value={receipt.category_id ?? ""} />
                          <Button type="submit" variant="secondary">
                            Marcar
                          </Button>
                        </form>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-decorato-line p-4 text-sm text-decorato-muted">
          <span>
            Página {page} de {pageCount}
          </span>
          <span>{sortedRows.length} registro(s) no filtro</span>
        </div>
      </section>
    </div>
  );
}

function Select({
  name,
  label,
  defaultValue,
  children
}: {
  name: string;
  label: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-decorato-muted">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 h-10 w-full rounded-md border border-decorato-line px-2 text-sm outline-none focus:ring-2 focus:ring-decorato-teal/30"
      >
        {children}
      </select>
    </label>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <article className="rounded-lg border border-decorato-line bg-white p-4 shadow-sm">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-decorato-teal/10 text-decorato-teal">
        {icon}
      </div>
      <p className="text-sm text-decorato-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-decorato-ink">{value}</p>
    </article>
  );
}

function buildCharts(
  receipts: ContentAudienceReceipt[],
  events: RawEvent[],
  profiles: Profile[],
  profileById: Map<string, Profile>,
  departmentById: Map<string, Category>,
  contentTitles: Map<string, string>,
  activeUserIds: Set<string>
) {
  return {
    openingsByDepartment: aggregateByDepartment(receipts, profileById, departmentById, "open_count", "opens"),
    secondsByDepartment: aggregateByDepartment(receipts, profileById, departmentById, "total_active_seconds", "seconds"),
    topOpenedContent: topByContent(receipts, contentTitles, "open_count", "opens", "desc"),
    leastOpenedContent: topByContent(receipts, contentTitles, "open_count", "opens", "asc"),
    topTimedContent: topByContent(receipts, contentTitles, "total_active_seconds", "seconds", "desc"),
    topOpeningUsers: topByUser(receipts, profileById, "opens"),
    topTimedUsers: topByUser(receipts, profileById, "seconds"),
    inactiveByDepartment: inactiveByDepartment(profiles, activeUserIds, departmentById),
    viewedRateByDepartment: viewedByDepartment(receipts, profileById, departmentById),
    opensByDay: dailyOpens(events),
    averageSecondsByUser: topByUser(receipts, profileById, "averageSeconds")
  };
}

function aggregateByDepartment(
  receipts: ContentAudienceReceipt[],
  profiles: Map<string, Profile>,
  departments: Map<string, Category>,
  source: "open_count" | "total_active_seconds",
  target: "opens" | "seconds"
): ChartDatum[] {
  const result = new Map<string, ChartDatum>();
  receipts.forEach((receipt) => {
    const name = departmentName(departmentIdForReceipt(receipt, profiles.get(receipt.user_id)), departments);
    const existing = result.get(name) ?? { name, [target]: 0 };
    existing[target] = (existing[target] ?? 0) + receipt[source];
    result.set(name, existing);
  });
  return sortTop([...result.values()], target, 10, "desc");
}

function topByUser(
  receipts: ContentAudienceReceipt[],
  profiles: Map<string, Profile>,
  metric: "opens" | "seconds" | "averageSeconds"
): ChartDatum[] {
  const grouped = new Map<string, { name: string; opens: number; seconds: number }>();
  receipts.forEach((receipt) => {
    const profile = profiles.get(receipt.user_id);
    const name = profile ? displayUser(profile) : receipt.user_id.slice(0, 8);
    const existing = grouped.get(receipt.user_id) ?? { name, opens: 0, seconds: 0 };
    existing.opens += receipt.open_count;
    existing.seconds += receipt.total_active_seconds;
    grouped.set(receipt.user_id, existing);
  });

  return [...grouped.values()]
    .map((item) => ({
      name: item.name,
      opens: item.opens,
      seconds: item.seconds,
      averageSeconds: item.opens > 0 ? Math.round(item.seconds / item.opens) : 0
    }))
    .sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))
    .slice(0, 10);
}

function topByContent(
  receipts: ContentAudienceReceipt[],
  titles: Map<string, string>,
  source: "open_count" | "total_active_seconds",
  target: "opens" | "seconds",
  direction: "asc" | "desc"
): ChartDatum[] {
  const result = new Map<string, ChartDatum>();
  receipts.forEach((receipt) => {
    const key = `${receipt.content_type}:${receipt.content_id}`;
    const name = titles.get(key) ?? `${contentTypeLabel(receipt.content_type)} ${receipt.content_id.slice(0, 8)}`;
    const existing = result.get(key) ?? { name, [target]: 0 };
    existing[target] = (existing[target] ?? 0) + receipt[source];
    result.set(key, existing);
  });
  return sortTop([...result.values()], target, 10, direction);
}

function inactiveByDepartment(profiles: Profile[], activeUserIds: Set<string>, departments: Map<string, Category>): ChartDatum[] {
  const result = new Map<string, ChartDatum>();
  profiles.forEach((profile) => {
    if (activeUserIds.has(profile.id)) {
      return;
    }
    const name = departmentName(profile.department_category_id ?? null, departments);
    const existing = result.get(name) ?? { name, inactive: 0 };
    existing.inactive = (existing.inactive ?? 0) + 1;
    result.set(name, existing);
  });
  return sortTop([...result.values()], "inactive", 10, "desc");
}

function viewedByDepartment(
  receipts: ContentAudienceReceipt[],
  profiles: Map<string, Profile>,
  departments: Map<string, Category>
): ChartDatum[] {
  const result = new Map<string, ChartDatum>();
  receipts.forEach((receipt) => {
    const name = departmentName(departmentIdForReceipt(receipt, profiles.get(receipt.user_id)), departments);
    const existing = result.get(name) ?? { name, viewed: 0, notViewed: 0 };
    if (receipt.is_viewed) {
      existing.viewed = (existing.viewed ?? 0) + 1;
    } else {
      existing.notViewed = (existing.notViewed ?? 0) + 1;
    }
    result.set(name, existing);
  });
  return [...result.values()].slice(0, 10);
}

function dailyOpens(events: RawEvent[]): ChartDatum[] {
  const result = new Map<string, ChartDatum>();
  events.forEach((event) => {
    const day = event.created_at.slice(5, 10);
    const existing = result.get(day) ?? { name: day, opens: 0 };
    existing.opens = (existing.opens ?? 0) + 1;
    result.set(day, existing);
  });
  return [...result.values()];
}

function buildContentTitleMap(
  documents: Array<{ id: string; title: string }> | null,
  announcements: Array<{ id: string; title: string }> | null,
  onboarding: Array<{ id: string; title: string }> | null,
  folderLinks: Array<{ id: string; title: string }> | null,
  attachments: Array<{ id: string; original_name: string }> | null,
  fileVersions: Array<{ id: string; original_name: string; version_number: number }> | null
) {
  const map = new Map<string, string>();
  documents?.forEach((item) => map.set(`document:${item.id}`, item.title));
  announcements?.forEach((item) => {
    map.set(`announcement:${item.id}`, item.title);
    map.set(`popup:${item.id}`, item.title);
    map.set(`banner:${item.id}`, item.title);
  });
  onboarding?.forEach((item) => map.set(`onboarding:${item.id}`, item.title));
  folderLinks?.forEach((item) => map.set(`folder_link:${item.id}`, item.title));
  attachments?.forEach((item) => map.set(`attachment:${item.id}`, item.original_name));
  fileVersions?.forEach((item) => map.set(`document_version:${item.id}`, `${item.original_name} v${item.version_number}`));
  return map;
}

function contentTitle(receipt: ContentAudienceReceipt, titles: Map<string, string>) {
  return titles.get(`${receipt.content_type}:${receipt.content_id}`) ?? receipt.content_id.slice(0, 8);
}

function displayUser(profile: Profile) {
  return profile.full_name || profile.username || profile.email || profile.id.slice(0, 8);
}

function departmentIdForReceipt(receipt: ContentAudienceReceipt, profile: Profile | undefined) {
  return receipt.assigned_department_category_id ?? profile?.department_category_id ?? null;
}

function departmentName(departmentId: string | null, departments: Map<string, Category>) {
  if (!departmentId) {
    return "Global";
  }
  return departments.get(departmentId)?.name ?? "Sem departamento";
}

function contentTypeLabel(type: EngagementContentType) {
  const labels: Record<EngagementContentType, string> = {
    document: "Documento",
    announcement: "Comunicado",
    popup: "Popup",
    banner: "Banner",
    onboarding: "Onboarding",
    folder_link: "Link de pasta",
    attachment: "Arquivo",
    document_version: "Versao de documento"
  };
  return labels[type];
}

function viewedSourceLabel(value: string | null) {
  if (value === "manual") return "Manual";
  if (value === "auto") return "Automático";
  if (value === "admin") return "Admin";
  return "-";
}

function isContentType(value: string | undefined): value is EngagementContentType {
  return (
    value === "document" ||
    value === "announcement" ||
    value === "popup" ||
    value === "banner" ||
    value === "onboarding" ||
    value === "folder_link" ||
    value === "attachment" ||
    value === "document_version"
  );
}

function sortTop(data: ChartDatum[], key: keyof ChartDatum, limit: number, direction: "asc" | "desc") {
  const modifier = direction === "asc" ? 1 : -1;
  return data.sort((a, b) => (Number(a[key] ?? 0) - Number(b[key] ?? 0)) * modifier).slice(0, limit);
}

function attentionStatus(receipt: ContentAudienceReceipt) {
  if (receipt.attention_status) {
    return receipt.attention_status;
  }
  if (receipt.open_count === 0) {
    return "not_opened";
  }
  if (receipt.is_viewed) {
    return "good_attention";
  }
  const expected = Number(receipt.expected_seconds ?? 0);
  if (expected <= 0) {
    return "partial_attention";
  }
  const ratio = receipt.total_active_seconds / expected;
  if (ratio >= 0.8) return "good_attention";
  if (ratio >= 0.4) return "partial_attention";
  return "low_attention";
}

function attentionLabel(receipt: ContentAudienceReceipt) {
  if (receipt.is_viewed && receipt.viewed_source === "admin") return "Visualizado pelo admin";
  if (receipt.is_viewed) return "Visualizado manualmente";
  const labels: Record<string, string> = {
    completed: "Viu ate o final",
    good_attention: "Boa atencao",
    low_attention: "Abriu rapido demais",
    not_opened: "Nao abriu",
    partial_attention: "Atencao parcial"
  };
  return labels[attentionStatus(receipt)] ?? "Atencao parcial";
}

function attentionPercent(receipt: ContentAudienceReceipt) {
  const expected = Number(receipt.expected_seconds ?? 0);
  if (expected <= 0) {
    return receipt.open_count > 0 ? 100 : 0;
  }
  return Math.min(100, Math.round((receipt.total_active_seconds / expected) * 100));
}

function sumExpectedSeconds(items: ContentAudienceReceipt[]) {
  return items.reduce((total, item) => total + Number(item.expected_seconds ?? 0), 0);
}

function sumOptional(items: ContentAudienceReceipt[], key: "video_completed_count") {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function sum(items: ContentAudienceReceipt[], key: "open_count" | "total_active_seconds") {
  return items.reduce((total, item) => total + item[key], 0);
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest > 0 ? `${minutes}min ${rest}s` : `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest > 0 ? `${hours}h ${minuteRest}min` : `${hours}h`;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}
