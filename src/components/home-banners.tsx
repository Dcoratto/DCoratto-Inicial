import { ContentViewTracker } from "@/components/content-view-tracker";
import { ProtectedMedia } from "@/components/protected-media";
import type { BannerAnnouncement } from "@/types/app";

export function HomeBanners({ banners }: { banners: BannerAnnouncement[] }) {
  const imageBanners = banners.filter(
    (banner) => (banner.mediaUrl || banner.mediaStoragePath) && banner.mediaMimeType?.startsWith("image/")
  );

  if (imageBanners.length === 0) {
    return null;
  }

  const [featured, ...secondary] = imageBanners;

  return (
    <section className="space-y-3">
      <article className="relative overflow-hidden rounded-lg border border-decorato-line bg-decorato-ink shadow-sm">
        <ContentViewTracker contentType="banner" contentId={featured.id} heartbeat={false} />
        <ProtectedMedia
          storagePath={featured.mediaStoragePath}
          initialUrl={featured.mediaUrl}
          mimeType={featured.mediaMimeType}
          alt={featured.title}
          className="aspect-[16/5] w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-decorato-ink/72 via-decorato-ink/28 to-transparent" />
        <div className="absolute inset-0 flex items-end p-5 sm:p-7">
          <div className="max-w-2xl text-white">
            <p className="text-xs uppercase tracking-wide text-white/75">Destaque</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight">{featured.title}</h2>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/85">{featured.body}</p>
          {featured.bannerEndsAt ? (
              <p className="mt-3 text-xs text-white/75">
                Disponível até {new Date(featured.bannerEndsAt).toLocaleDateString("pt-BR")}
            </p>
          ) : null}
          </div>
        </div>
      </article>

      {secondary.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {secondary.map((banner) => (
            <article key={banner.id} className="relative overflow-hidden rounded-lg border border-decorato-line bg-decorato-ink">
              <ContentViewTracker contentType="banner" contentId={banner.id} heartbeat={false} />
              <ProtectedMedia
                storagePath={banner.mediaStoragePath}
                initialUrl={banner.mediaUrl}
                mimeType={banner.mediaMimeType}
                alt={banner.title}
                className="aspect-[16/5] w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-decorato-ink/70 via-decorato-ink/24 to-transparent" />
              <div className="absolute inset-0 flex items-end p-4">
                <div className="max-w-lg text-white">
                  <h3 className="font-semibold">{banner.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-white/85">{banner.body}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
