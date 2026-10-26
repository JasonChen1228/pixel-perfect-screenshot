import { useEffect } from "react";

export type PageMeta = {
  title: string;
  description?: string;
  /** Extra <meta> tags, keyed by `name` or `property`. */
  meta?: Array<{ name?: string; property?: string; content: string }>;
};

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Client-side replacement for TanStack's per-route `head()`: sets title and meta tags. */
export function usePageMeta({ title, description, meta = [] }: PageMeta) {
  const metaKey = JSON.stringify(meta);
  useEffect(() => {
    document.title = title;
    if (description) upsertMeta("name", "description", description);
    for (const m of JSON.parse(metaKey) as NonNullable<PageMeta["meta"]>) {
      if (m.name) upsertMeta("name", m.name, m.content);
      else if (m.property) upsertMeta("property", m.property, m.content);
    }
    // Pages that set robots (e.g. noindex) shouldn't leak it to the next page.
    return () => {
      document.head.querySelector('meta[name="robots"]')?.remove();
    };
  }, [title, description, metaKey]);
}
