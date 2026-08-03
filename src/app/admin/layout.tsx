import { AdminNav } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { getCategoriesForUser, getPopupAnnouncementsForUser } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await requireAdmin();
  const [categories, popupAnnouncements] = await Promise.all([
    getCategoriesForUser(currentUser.profile),
    getPopupAnnouncementsForUser(currentUser.profile)
  ]);

  return (
    <AppShell profile={currentUser.profile} categories={categories} popupAnnouncements={popupAnnouncements}>
      <AdminNav />
      {children}
    </AppShell>
  );
}
