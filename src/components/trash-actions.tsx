"use client";

import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function TrashItemActions({
  itemType,
  itemId,
  canPermanentlyDelete
}: {
  itemType: string;
  itemId: string;
  canPermanentlyDelete: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"restore" | "permanentDelete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "restore" | "permanentDelete") {
    if (action === "permanentDelete" && !window.confirm("Excluir definitivamente? Esta acao nao podera ser desfeita.")) {
      return;
    }

    setPending(action);
    setError(null);
    const response = await fetch("/api/trash/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, itemType, itemId })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setPending(null);

    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "Nao foi possivel executar a acao.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" onClick={() => void run("restore")} disabled={pending !== null}>
        {pending === "restore" ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <RotateCcw aria-hidden="true" size={15} />}
        Restaurar
      </Button>
      <Button
        type="button"
        variant="danger"
        onClick={() => void run("permanentDelete")}
        disabled={pending !== null || !canPermanentlyDelete}
        title={canPermanentlyDelete ? "Excluir definitivamente" : "Disponivel apos 30 dias na lixeira"}
      >
        {pending === "permanentDelete" ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <Trash2 aria-hidden="true" size={15} />}
        Excluir definitivamente
      </Button>
      {error ? <span className="basis-full text-xs text-decorato-coral">{error}</span> : null}
    </div>
  );
}

export function PurgeExpiredTrashButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function purgeExpired() {
    if (!window.confirm("Excluir definitivamente todos os itens expirados da lixeira?")) {
      return;
    }

    setPending(true);
    setMessage(null);
    const response = await fetch("/api/trash/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "purgeExpired" })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; purged?: Array<{ ok?: boolean }> } | null;
    setPending(false);

    if (!response.ok || !payload?.ok) {
      setMessage("Nao foi possivel limpar a lixeira.");
      return;
    }

    const count = payload.purged?.filter((item) => item.ok).length ?? 0;
    setMessage(`${count} item(ns) expirado(s) excluido(s) definitivamente.`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="danger" onClick={() => void purgeExpired()} disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <Trash2 aria-hidden="true" size={15} />}
        Excluir definitivamente itens expirados
      </Button>
      {message ? <span className="text-sm text-decorato-muted">{message}</span> : null}
    </div>
  );
}
