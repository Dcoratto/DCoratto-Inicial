import { AppShell } from "@/components/app-shell";
import { requireAuth } from "@/lib/auth";
import { getCategoriesForUser, getPopupAnnouncementsForUser } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ProtectedAppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const currentUser = await requireAuth();
  const [categories, popupAnnouncements] = await Promise.all([
    getCategoriesForUser(currentUser.profile),
    getPopupAnnouncementsForUser(currentUser.profile)
  ]);

  return (
    <AppShell profile={currentUser.profile} categories={categories} popupAnnouncements={popupAnnouncements}>
      {children}
    </AppShell>
  );
}
