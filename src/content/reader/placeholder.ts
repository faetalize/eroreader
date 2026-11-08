// What shows in place of a page whose image isn't there.
import type { PageState } from "./imageBuffer";

export function renderPlaceholder(doc: Document, page: number, state: PageState | undefined, onRetry: () => void): HTMLElement {
  const box = doc.createElement("div");
  box.className = "placeholder";
  const text = doc.createElement("p");
  box.append(text);
  const action = (label: string) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onRetry();
    });
    box.append(button);
  };
  switch (state?.status) {
    case "error":
      text.textContent = `Couldn't load page ${page}.`;
      action("Retry");
      break;
    case "limit":
      box.classList.add("limit");
      text.textContent = "Image limit reached. Preloading has stopped.";
      action("Try again");
      break;
    case "pending":
    case "loading":
      text.textContent = `Loading page ${page}…`;
      break;
    default:
      text.textContent = `Page ${page}`;
  }
  return box;
}
