// Plain left clicks on a thumbnail open the reader at that page. Modified clicks (new tab and
// so on) keep the site's own link.

const PAGE_OF_HREF = /\/s\/[0-9a-f]+\/\d+-(\d+)/;

export function interceptThumbClicks(doc: Document, open: (page: number) => void): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("#gdt a[href]");
    const match = link ? PAGE_OF_HREF.exec(link.getAttribute("href")!) : null;
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    open(Number(match[1]));
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}
