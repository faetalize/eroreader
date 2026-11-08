// Small line icons for buttons on the extension's page and in the reader, drawn in the current
// text colour.

const PATHS = {
  trash: "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  coverOff: "M4 5h16v14H4zM4 15l4-4 4 4M14 13l2-2 4 4M3 3l18 18",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8",
  close: "M6 6l12 12M18 6 6 18",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  play: "M8 5v14l11-7z",
  check: "M5 12.5l4.5 4.5L19 7",
  toStart: "M6 4h12M12 20V9M7 14l5-5 5 5",
  toEnd: "M6 20h12M12 4v11M7 10l5 5 5-5",
  target: "M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  flag: "M6 21V4M6 4h11l-2 4 2 4H6",
  filmstrip: "M3 5h18v10H3zM5 19h3M10.5 19h3M16 19h3",
  grid: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  dockBottom: "M4 5h16v14H4zM4 14.5h16",
  dockLeft: "M4 5h16v14H4zM9.5 5v14",
  sort: "M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5",
  magnify: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8M10.5 8v5M8 10.5h5",
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, doc: Document = document): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = doc.createElementNS(ns, "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  return svg;
}
