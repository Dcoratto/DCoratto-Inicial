"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type ChartDatum = {
  name: string;
  opens?: number;
  seconds?: number;
  averageSeconds?: number;
  viewed?: number;
  notViewed?: number;
  uniqueUsers?: number;
  inactive?: number;
};

export function EngagementDashboardCharts({
  openingsByDepartment,
  secondsByDepartment,
  topOpenedContent,
  topTimedContent,
  topOpeningUsers,
  topTimedUsers,
  inactiveByDepartment,
  leastOpenedContent,
  viewedRateByDepartment,
  opensByDay,
  averageSecondsByUser
}: {
  openingsByDepartment: ChartDatum[];
  secondsByDepartment: ChartDatum[];
  topOpenedContent: ChartDatum[];
  topTimedContent: ChartDatum[];
  topOpeningUsers: ChartDatum[];
  topTimedUsers: ChartDatum[];
  inactiveByDepartment: ChartDatum[];
  leastOpenedContent: ChartDatum[];
  viewedRateByDepartment: ChartDatum[];
  opensByDay: ChartDatum[];
  averageSecondsByUser: ChartDatum[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Aberturas por Departamento">
        <SimpleBarChart data={openingsByDepartment} dataKey="opens" color="#0ea5a3" />
      </ChartCard>
      <ChartCard title="Tempo Total por Departamento">
        <SimpleBarChart data={secondsByDepartment} dataKey="seconds" color="#f97361" />
      </ChartCard>
      <ChartCard title="Colaboradores com Mais Aberturas">
        <SimpleBarChart data={topOpeningUsers} dataKey="opens" color="#5b8def" />
      </ChartCard>
      <ChartCard title="Colaboradores com Maior Tempo">
        <SimpleBarChart data={topTimedUsers} dataKey="seconds" color="#7cbd64" />
      </ChartCard>
      <ChartCard title="Profissionais Sem Atividade por Departamento">
        <SimpleBarChart data={inactiveByDepartment} dataKey="inactive" color="#f8bd4f" />
      </ChartCard>
      <ChartCard title="Conteúdos Mais Abertos">
        <SimpleBarChart data={topOpenedContent} dataKey="opens" color="#0ea5a3" />
      </ChartCard>
      <ChartCard title="Conteúdos Menos Abertos">
        <SimpleBarChart data={leastOpenedContent} dataKey="opens" color="#f97361" />
      </ChartCard>
      <ChartCard title="Conteúdos com Maior Tempo">
        <SimpleBarChart data={topTimedContent} dataKey="seconds" color="#7cbd64" />
      </ChartCard>
      <ChartCard title="Visualizado vs Não Visualizado">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={viewedRateByDepartment}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="viewed" name="Visualizado" stackId="a" fill="#0ea5a3" />
            <Bar dataKey="notViewed" name="Não visualizado" stackId="a" fill="#f97361" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Aberturas por Dia">
        <SimpleLineChart data={opensByDay} dataKey="opens" color="#0ea5a3" />
      </ChartCard>
      <ChartCard title="Tempo Médio por Colaborador">
        <SimpleBarChart data={averageSecondsByUser} dataKey="averageSeconds" color="#5b8def" />
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-decorato-line bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-decorato-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SimpleBarChart({ data, dataKey, color }: { data: ChartDatum[]; dataKey: keyof ChartDatum; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-12} textAnchor="end" height={56} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey={dataKey as string} fill={color} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SimpleLineChart({ data, dataKey, color }: { data: ChartDatum[]; dataKey: keyof ChartDatum; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Line type="monotone" dataKey={dataKey as string} stroke={color} strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function EngagementViewedPie({ viewed, notViewed }: { viewed: number; notViewed: number }) {
  const data = [
    { name: "Visualizado", value: viewed },
    { name: "Não visualizado", value: notViewed }
  ];
  const colors = ["#0ea5a3", "#f97361"];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={82} paddingAngle={4}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={colors[index]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
