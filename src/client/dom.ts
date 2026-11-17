// Tiny DOM builder shared by splash and game (no framework, no innerHTML).

export type Attrs = Record<string, string | number | boolean | undefined>;
export type Child = Node | string | null | undefined | false;

const applyAttrs = (node: Element, attrs: Attrs) => {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.setAttribute('class', String(value));
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
};

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  for (const child of children) if (child) node.append(child);
  return node;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export const s = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  for (const child of children) if (child) node.append(child);
  return node;
};

export const byId = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
};
