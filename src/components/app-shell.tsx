import Image from "next/image";
import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { AnnouncementPopup } from "@/components/announcement-popup";
import { GlobalSearch } from "@/components/global-search";
import { SidebarTree } from "@/components/sidebar-tree";
import type { Category, PopupAnnouncement, Profile } from "@/types/app";

export function AppShell({
  profile,
  categories,
  popupAnnouncements = [],
  children
}: {
  profile: Profile;
  categories: Category[];
  popupAnnouncements?: PopupAnnouncement[];
  children: React.ReactNode;
}) {
  const homeHref = profile.role === "admin" ? "/admin" : "/app";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-decorato-line bg-decorato-paper/95 backdrop-blur">
        <div className="flex min-h-16 items-center gap-3 px-4 lg:px-5">
          <SidebarTree categories={categories} homeHref={homeHref} showDesktop={false} isAdmin={profile.role === "admin"} />
          <Link
            href={homeHref}
            className="grid h-11 w-36 shrink-0 place-items-center rounded-lg bg-decorato-ink px-3"
          >
            <Image src="/logo-dcoratto.png" alt="D'Coratto" width={148} height={56} className="h-8 w-auto" priority />
          </Link>
          <div className="mx-auto hidden w-full max-w-3xl md:block">
            <GlobalSearch />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {profile.role === "admin" ? (
              <Link
                href="/app/account/password"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-decorato-line bg-white text-decorato-muted hover:text-decorato-ink"
                aria-label="Configurações"
                title="Configurações"
              >
                <Settings aria-hidden="true" size={18} />
              </Link>
            ) : null}
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-decorato-line bg-white text-decorato-muted hover:text-decorato-ink"
                aria-label="Sair"
                title="Sair"
              >
                <LogOut aria-hidden="true" size={18} />
              </button>
            </form>
          </div>
        </div>
        <div className="border-t border-decorato-line px-4 py-3 md:hidden">
          <GlobalSearch />
        </div>
      </header>
      <div className="flex">
        <SidebarTree categories={categories} homeHref={homeHref} showMobileButton={false} isAdmin={profile.role === "admin"} />
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            {profile.must_change_password ? (
              <div className="mb-5 rounded-lg border border-decorato-sun bg-decorato-sun/20 p-4 text-sm text-decorato-ink">
                Sua senha inicial ainda precisa ser trocada.{" "}
                <Link href="/app/account/password" className="font-medium text-decorato-teal">
                  Atualizar senha
                </Link>
              </div>
            ) : null}
            {children}
          </div>
        </main>
      </div>
      <AnnouncementPopup announcements={popupAnnouncements} />
    </div>
  );
}
