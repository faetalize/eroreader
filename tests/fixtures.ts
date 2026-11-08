import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHtml } from "../src/site/html";

// Vitest runs from the project root; under happy-dom, import.meta.url isn't a file URL.
export function fixtureText(name: string): string {
  return readFileSync(join(process.cwd(), "tests/fixtures", name), "utf8");
}

export function fixture(name: string): Document {
  return parseHtml(fixtureText(name));
}
