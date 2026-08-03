"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Megaphone,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  Workflow
} from "lucide-react";
import { cn } from "@/lib/utils";

const adminLinks = [
  { href: "/admin", label: "Painel", icon: LayoutDashboard },
  { href: "/admin/users", label: "Usuários", icon: UserRoundCog },
  { href: "/admin/documents", label: "Documentos", icon: FileText },
  { href: "/admin/categories", label: "Departamentos", icon: FolderKanban },
  { href: "/admin/announcements", label: "Comunicados", icon: Megaphone },
  { href: "/admin/onboarding", label: "Onboarding", icon: Workflow },
  { href: "/admin/engagement", label: "Engajamento", icon: BarChart3 },
  { href: "/admin/audit", label: "Auditoria", icon: ShieldCheck },
  { href: "/admin/trash", label: "Lixeira", icon: Trash2 }
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Administração" className="mb-6 overflow-x-auto rounded-xl border border-decorato-line bg-white p-2 shadow-sm">
      <div className="flex min-w-max gap-2">
        {adminLinks.map((link) => {
          const Icon = link.icon;
          const active = link.href === "/admin" ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-decorato-teal text-white shadow-sm"
                  : "text-decorato-muted hover:bg-decorato-paper hover:text-decorato-ink"
              )}
            >
              <Icon aria-hidden="true" size={16} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
