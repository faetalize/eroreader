// Helpers for reading site pages, whether the live document or one parsed from a fetch.

export function parseHtml(text: string): Document {
  return new DOMParser().parseFromString(text, "text/html");
}

export function textOf(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? "";
}

// Reads `var name = value;` from the page's inline scripts. Only for public values such as
// `api_url` or `showkey`: account values like `apikey` and `apiuid` are never read.
export function scriptVar(doc: Document, name: string): string | null {
  const re = new RegExp(`\\bvar\\s+${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(-?[\\d.]+))`);
  for (const script of doc.querySelectorAll("script:not([src])")) {
    const match = re.exec(script.textContent ?? "");
    if (match) return match[1] ?? match[2] ?? match[3] ?? null;
  }
  return null;
}

// First `url(...)` in an inline style, unquoted.
export function styleUrl(style: string): string | null {
  const match = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(style);
  return match ? match[1]! : null;
}

export function stylePx(style: string, property: string): number | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`).exec(style);
  return match ? Number(match[1]) : null;
}
