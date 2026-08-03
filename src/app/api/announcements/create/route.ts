import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createAnnouncementFromFormData } from "@/lib/announcements/create";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const route = "/api/announcements/create";
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
          error: "Não foi possível ler o arquivo enviado. Verifique o tamanho e o formato."
        },
        { status: 400 }
      );
    }

    await createAnnouncementFromFormData(formData, currentUser.id);

    revalidatePath("/admin/announcements");
    revalidatePath("/app");
    revalidatePath("/app/announcements");

    return NextResponse.json({ ok: true });
  } catch (error) {
    const friendlyError = getFriendlyAnnouncementError(error);
    console.error("Falha ao criar comunicado", {
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
      message: "Revise título, mensagem, datas e duração antes de salvar o comunicado."
    };
  }

  const message = error instanceof Error ? error.message : "";

  if (message.startsWith("A estrutura ")) {
    return {
      status: 500,
      message
    };
  }

  if (isSafeAnnouncementMessage(message)) {
    return {
      status: 400,
      message
    };
  }

  return {
    status: 500,
    message: "Não foi possível criar o comunicado. Verifique os arquivos e tente novamente."
  };
}

function isSafeAnnouncementMessage(message: string) {
  return [
    "Envie ",
    "Arquivo ",
    "Tipo de arquivo",
    "PDF ",
    "Vídeo ",
    "Assinatura ",
    "Imagem recusada.",
    "Banners aceitam ",
    "Popup aceita ",
    "Banner aceita ",
    "A mídia ",
    "A imagem ",
    "A estrutura ",
    "Não foi possível "
  ].some((prefix) => message.startsWith(prefix));
}
