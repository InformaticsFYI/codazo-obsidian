import { TFile, TFolder, type App } from 'obsidian';

/**
 * An index of everything Codazo has saved in the vault, read from the
 * metadata cache only (no file reads): reviews, study sheets, excerpts,
 * revisions, words, and verbs. Loading an entry into the pane re-validates
 * its payload; nothing here calls a provider.
 */
export type IndexKind = 'review' | 'study' | 'excerpt' | 'revision' | 'palabra' | 'verbo';
export const INDEX_KINDS: readonly IndexKind[] = ['review', 'study', 'excerpt', 'revision', 'palabra', 'verbo'];
export type IndexEntry = { file: TFile; kind: IndexKind; title: string; at: string; sourcePath: string | null; sourceLink: string | null; progress: string | null; loadable: boolean };

/** A string-valued frontmatter property, or null; frontmatter is untyped YAML and is never trusted beyond that. */
export function frontmatterString(frontmatter: Record<string, unknown> | undefined, key: string): string | null {
  const value = frontmatter?.[key];
  return typeof value === 'string' ? value : null;
}

export function collectIndex(app: App, folderPath: string): IndexEntry[] {
  const folder = app.vault.getFolderByPath(folderPath);
  if (!folder) return [];
  const entries: IndexEntry[] = [];
  const walk = (node: TFolder) => {
    for (const child of node.children) {
      if (child instanceof TFolder) { walk(child); continue; }
      if (!(child instanceof TFile) || child.extension !== 'md') continue;
      const fm: Record<string, unknown> | undefined = app.metadataCache.getFileCache(child)?.frontmatter;
      const kind = frontmatterString(fm, 'codazo-kind');
      if (kind === null || !(INDEX_KINDS as readonly string[]).includes(kind)) continue;
      const link = frontmatterString(fm, 'codazo-source');
      const source = link ? app.metadataCache.getFirstLinkpathDest(link.replace(/^\[\[|\]\]$/g, '').split('|')[0], child.path) : null;
      const at = frontmatterString(fm, 'codazo-reviewed-at') ?? frontmatterString(fm, 'codazo-created-at') ?? new Date(child.stat.ctime).toISOString();
      entries.push({ file: child, kind: kind as IndexKind, title: child.basename, at, sourcePath: source?.path ?? null, sourceLink: link, progress: frontmatterString(fm, 'codazo-progreso'), loadable: kind === 'review' || kind === 'study' || kind === 'excerpt' });
    }
  };
  walk(folder);
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
