// A small padlock, shown while hands-free mode is locked.
const SVG = "http://www.w3.org/2000/svg";

export function lockIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "lock-icon");
  svg.setAttribute("aria-label", "Locked");
  svg.setAttribute("role", "img");
  const shackle = doc.createElementNS(SVG, "path");
  shackle.setAttribute("d", "M5 7V5a3 3 0 0 1 6 0v2");
  shackle.setAttribute("fill", "none");
  shackle.setAttribute("stroke", "currentColor");
  shackle.setAttribute("stroke-width", "1.8");
  const body = doc.createElementNS(SVG, "rect");
  body.setAttribute("x", "3");
  body.setAttribute("y", "7");
  body.setAttribute("width", "10");
  body.setAttribute("height", "8");
  body.setAttribute("rx", "1.5");
  body.setAttribute("fill", "currentColor");
  svg.append(shackle, body);
  return svg;
}
