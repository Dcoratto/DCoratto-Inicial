import Link from "next/link";
import { FileText } from "lucide-react";
import type { DocumentListItem } from "@/types/app";

export function DocumentCard({ document }: { document: DocumentListItem }) {
  return (
    <Link
      href={`/app/documents/${document.slug}`}
      className="group block rounded-lg border border-decorato-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
    >
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-decorato-teal/10 p-2 text-decorato-teal">
          <FileText aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-semibold text-decorato-ink group-hover:text-decorato-teal">
            {document.title}
          </h3>
          {document.summary ? (
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-decorato-muted">{document.summary}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {document.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full bg-decorato-paper px-2 py-1 text-xs text-decorato-muted">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
