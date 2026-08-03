"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateUserRole } from "@/actions/users";
import { Button } from "@/components/ui/button";

type UserRole = "admin" | "viewer";

export function UserRoleControl({ userId, currentRole }: { userId: string; currentRole: UserRole }) {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>(currentRole);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (role === currentRole) return;
    const message =
      role === "admin"
        ? "Este usuário terá acesso total ao sistema. Deseja torná-lo administrador?"
        : "Este usuário perderá acesso administrativo e ficará como colaborador.";
    if (!window.confirm(message)) return;

    setError(null);
    startTransition(async () => {
      const result = await updateUserRole({ userId, role });
      if (!result.ok) {
        setError(result.error ?? "Não foi possível alterar o papel.");
        setRole(currentRole);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-decorato-muted">
        Papel
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
          disabled={pending}
          className="h-10 rounded-md border border-decorato-line bg-white px-3 text-sm text-decorato-ink"
        >
          <option value="admin">Administrador</option>
          <option value="viewer">Colaborador</option>
        </select>
      </label>
      <Button type="button" variant="secondary" onClick={save} disabled={pending || role === currentRole}>
        {pending ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <ShieldCheck aria-hidden="true" size={15} />}
        Alterar papel
      </Button>
      {error ? <p className="basis-full text-xs text-decorato-coral">{error}</p> : null}
    </div>
  );
}
