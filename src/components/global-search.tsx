"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SearchResult } from "@/types/app";

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const trimmed = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal
        });
        if (response.ok) {
          const payload = (await response.json()) as { results: SearchResult[] };
          setResults(payload.results);
        }
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  return (
    <div className="relative w-full">
      <label className="sr-only" htmlFor="global-search">
        Buscar na base de conhecimento
      </label>
      <div className="flex h-11 items-center gap-2 rounded-lg border border-decorato-line bg-white px-3 shadow-sm">
        <Search aria-hidden="true" size={18} className="text-decorato-muted" />
        <input
          id="global-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar procedimentos, comunicados e onboarding"
          className="w-full bg-transparent text-sm outline-none placeholder:text-decorato-muted"
        />
      </div>

      {trimmed.length >= 2 ? (
        <div className="absolute left-0 right-0 z-30 mt-2 max-h-96 overflow-auto rounded-lg border border-decorato-line bg-white p-2 shadow-soft">
          {loading ? <p className="px-3 py-2 text-sm text-decorato-muted">Buscando...</p> : null}
          {!loading && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-decorato-muted">Nenhum resultado encontrado.</p>
          ) : null}
          {results.map((result) => (
            <Link
              key={`${result.type}-${result.id}`}
              href={result.href}
              className="block rounded-md px-3 py-2 text-sm transition hover:bg-decorato-paper"
              onClick={() => setQuery("")}
            >
              <span className="text-xs uppercase tracking-wide text-decorato-muted">{typeLabel(result.type)}</span>
              <span className="mt-1 block text-decorato-ink">{result.title}</span>
              {result.summary ? (
                <span className="mt-1 block line-clamp-2 text-xs leading-5 text-decorato-muted">
                  {result.summary}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function typeLabel(type: SearchResult["type"]) {
  if (type === "announcement") return "Comunicado";
  if (type === "onboarding") return "Onboarding";
  return "Documento";
}
