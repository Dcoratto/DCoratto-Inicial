"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AnnouncementTrashButton({ announcementId }: { announcementId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function moveToTrash() {
    if (
      !window.confirm(
        "Este comunicado será movido para a Lixeira e poderá ser restaurado por até 30 dias. Ele deixará de aparecer para colaboradores, incluindo banner e popup vinculados."
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);
    const response = await fetch("/api/trash/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "moveToTrash", itemType: "announcement", itemId: announcementId })
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setPending(false);

    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "Não foi possível mover o comunicado para a lixeira.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <Button type="button" variant="danger" onClick={() => void moveToTrash()} disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <Trash2 aria-hidden="true" size={15} />}
        Mover para lixeira
      </Button>
      {error ? <p className="mt-1 max-w-xs text-xs text-decorato-coral">{error}</p> : null}
    </div>
  );
}
