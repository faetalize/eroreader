// Which pages to keep loaded, most important first: the pages on screen, then the pages
// ahead nearest first, then the pages behind nearest first.
export function preloadOrder(visible: number[], pageCount: number, ahead: number, behind: number): number[] {
  const order = [...visible];
  const last = Math.max(...visible);
  const first = Math.min(...visible);
  for (let i = 1; i <= ahead && last + i <= pageCount; i++) order.push(last + i);
  for (let i = 1; i <= behind && first - i >= 1; i++) order.push(first - i);
  return order;
}
