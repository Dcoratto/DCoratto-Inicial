import { redirect } from "next/navigation";

export default function AdminDepartmentsRedirectPage() {
  redirect("/admin/categories");
}
