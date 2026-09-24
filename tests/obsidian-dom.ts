/**
 * Minimal stand-ins for Obsidian's DOM augmentation (createEl, createSpan,
 * createDiv, doc, win, createFragment) so plugin renderers can run under
 * jsdom. Behavior mirrors the documented helpers: text via textContent,
 * cls as className, attr via setAttribute, node attached to the parent.
 */
type Info = { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null> } | string;
function build(doc: Document, tag: string, info?: Info): HTMLElement {
  const node = doc.createElement(tag);
  if (typeof info === 'string') node.className = info;
  else if (info) {
    if (info.cls) node.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
    if (info.text !== undefined) node.textContent = info.text;
    for (const [key, value] of Object.entries(info.attr ?? {})) if (value !== null) node.setAttribute(key, String(value));
  }
  return node;
}
export function installObsidianDom(): void {
  const proto = Node.prototype as unknown as Record<string, unknown>;
  const owner = (node: Node): Document => node.ownerDocument ?? (node as unknown as Document);
  proto.createEl = function (this: Node, tag: string, info?: Info) { const node = build(owner(this), tag, info); this.appendChild(node); return node; };
  proto.createSpan = function (this: Node, info?: Info) { return (this as unknown as { createEl: (t: string, i?: Info) => HTMLElement }).createEl('span', info); };
  proto.createDiv = function (this: Node, info?: Info) { return (this as unknown as { createEl: (t: string, i?: Info) => HTMLElement }).createEl('div', info); };
  Object.defineProperty(Node.prototype, 'doc', { configurable: true, get(this: Node) { return owner(this); } });
  Object.defineProperty(Document.prototype, 'win', { configurable: true, get(this: Document) { return this.defaultView; } });
  (Window.prototype as unknown as Record<string, unknown>).createFragment = function (this: Window) { return this.document.createDocumentFragment(); };
}
