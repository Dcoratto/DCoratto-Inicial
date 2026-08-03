import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateAnnouncementFromFormData } from "@/lib/announcements/create";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const route = "/api/announcements/update";
  const approximateSize = request.headers.get("content-length");

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.profile.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Acesso negado." }, { status: 403 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      console.error("Falha ao ler FormData", {
        route,
        errorType: error instanceof Error ? error.name : typeof error,
        approximateSize
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Nao foi possivel ler o arquivo enviado. Verifique o tamanho e o formato."
        },
        { status: 400 }
      );
    }

    await updateAnnouncementFromFormData(formData, currentUser.id);

    revalidatePath("/admin/announcements");
    revalidatePath("/admin/announcements/[id]/edit", "page");
    revalidatePath("/app");
    revalidatePath("/app/announcements");

    return NextResponse.json({ ok: true });
  } catch (error) {
    const friendlyError = getFriendlyAnnouncementError(error);
    console.error("Falha ao atualizar comunicado", {
      route,
      errorType: error instanceof Error ? error.name : typeof error,
      approximateSize,
      message: error instanceof Error ? error.message : "erro desconhecido"
    });
    return NextResponse.json(
      {
        ok: false,
        error: friendlyError.message
      },
      { status: friendlyError.status }
    );
  }
}

function getFriendlyAnnouncementError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      status: 400,
      message: "Revise titulo, mensagem, datas e duracao antes de salvar o comunicado."
    };
  }

  const message = error instanceof Error ? error.message : "";

  if (isSafeAnnouncementMessage(message)) {
    return {
      status: message.startsWith("A estrutura ") ? 500 : 400,
      message
    };
  }

  return {
    status: 500,
    message: "Nao foi possivel atualizar o comunicado. Verifique os arquivos e tente novamente."
  };
}

function isSafeAnnouncementMessage(message: string) {
  return [
    "Envie ",
    "Arquivo ",
    "Tipo de arquivo",
    "PDF ",
    "Video ",
    "Assinatura ",
    "Imagem recusada.",
    "Banners aceitam ",
    "Popup aceita ",
    "Banner aceita ",
    "A midia ",
    "A imagem ",
    "A estrutura ",
    "Comunicado ",
    "Nao foi possivel "
  ].some((prefix) => message.startsWith(prefix));
}
