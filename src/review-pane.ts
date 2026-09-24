import { ItemView, WorkspaceLeaf } from 'obsidian';
import { CODAZO_ICON_ID } from './icon';
import type { IndexEntry, IndexKind } from './index-view';
import type CodazoPlugin from './main';
import { accordion, el, renderAnnotatedSource, renderAnnotation, renderOverview, renderStudy, renderStudySource } from './render';
import { t } from './strings';

export const VIEW_TYPE = 'codazo-review';

/** Native side pane: provenance and freshness first, then feedback, study, and explicit actions. */
export class CodazoReviewView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: CodazoPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Codazo'; }
  getIcon(): string { return CODAZO_ICON_ID; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.classList.add('codazo-pane');
    const { session, status, freshness } = this.plugin.state;
    const open = this.plugin.data.sectionsOpen;
    const header = el(root, 'section', { cls: 'codazo-status' });
    if (status.kind !== 'idle') {
      // One bar: spinner while a request is out, green when it landed, orange when it failed. Always names the profile it went to.
      const bar = el(header, 'div', { cls: `codazo-bar codazo-bar-${status.kind}`, attrs: { role: status.kind === 'error' ? 'alert' : 'status' } });
      el(bar, 'span', { cls: status.kind === 'in_flight' ? 'codazo-spinner' : 'codazo-bar-dot', attrs: { 'aria-hidden': 'true' } });
      const body = el(bar, 'div', { cls: 'codazo-bar-body' });
      el(body, 'p', { cls: 'codazo-bar-message', text: status.kind === 'in_flight' ? (status.mode === 'study' ? t().statusStudying : status.mode === 'excerpt' ? t().statusExcerpting : t().statusReviewing) : status.kind === 'success' ? status.message : `${t().statusFailed} ${status.message}` });
      if (status.label) el(body, 'p', { cls: 'codazo-bar-label', text: status.label });
      if (status.kind === 'in_flight') { const cancel = el(bar, 'button', { text: t().cancel, attrs: { type: 'button' } }); cancel.addEventListener('click', () => this.plugin.cancelReview()); }
      else { const close = el(bar, 'button', { cls: 'codazo-bar-close', text: '×', attrs: { type: 'button', 'aria-label': t().dismiss } }); close.addEventListener('click', () => this.plugin.dismissStatus()); }
    }
    // Tabs: the current result and the index of everything saved in the vault.
    const tabs = el(header, 'div', { cls: 'codazo-tabs', attrs: { role: 'tablist' } });
    const tab = (view: 'result' | 'index', label: string) => { const button = el(tabs, 'button', { cls: `codazo-tab${this.plugin.state.view === view ? ' codazo-tab-active' : ''}`, text: label, attrs: { type: 'button', role: 'tab', 'aria-selected': String(this.plugin.state.view === view) } }); button.addEventListener('click', () => this.plugin.showView(view)); };
    tab('result', t().tabResult);
    tab('index', t().tabIndex);
    if (this.plugin.state.view === 'index') { this.renderIndex(root); return; }
    if (!session) {
      el(header, 'p', { cls: 'codazo-eyebrow', text: t().paneEyebrow });
      el(header, 'p', { text: t().paneEmpty });
      const entries = this.plugin.indexEntries();
      if (entries.length) { const link = el(header, 'button', { cls: 'codazo-link', text: t().indexHint(entries.length), attrs: { type: 'button' } }); link.addEventListener('click', () => this.plugin.showView('index')); }
      return;
    }
    // The banner names the profile while it is showing; once dismissed, one small line keeps the provenance visible.
    if (status.kind === 'idle') el(header, 'p', { cls: 'codazo-muted codazo-provenance', text: `${session.provider} · ${session.model} · ${new Date(session.reviewedAt).toLocaleString()}`, attrs: { title: `${session.generatedBy} · ${t().paneNote(session.notePath)}` } });
    if (freshness.status === 'stale') el(header, 'p', { cls: 'codazo-warning', text: freshness.reason === 'ambiguous' ? t().paneStaleAmbiguous : t().paneStaleMissing });
    else if (freshness.status === 'unavailable') el(header, 'p', { cls: 'codazo-warning', text: t().paneUnavailable });

    const live = freshness.status !== 'stale' && freshness.status !== 'unavailable';
    const select = (id: string) => {
      const card = root.querySelector<HTMLElement>(`.codazo-annotation[data-annotation="${id}"]`);
      for (const other of root.querySelectorAll('.codazo-selected')) other.classList.remove('codazo-selected');
      if (card) { card.classList.add('codazo-selected'); card.scrollIntoView({ block: 'nearest' }); card.focus(); }
      root.querySelector(`.codazo-source-mark[data-annotation="${id}"]`)?.classList.add('codazo-selected');
      if (live && session.kind === 'review') this.plugin.revealAnnotation(id);
    };
    if (session.kind === 'excerpt') {
      renderStudySource(root, session.review, select, t().excerptTitle);
      const actions = el(root, 'section', { cls: 'codazo-actions' });
      const action = (label: string, run: () => Promise<void> | void) => { const button = el(actions, 'button', { text: label, attrs: { type: 'button' } }); button.addEventListener('click', () => void run()); };
      action(session.savedReviewPath ? t().actionSaved : t().actionSaveReview, () => this.plugin.saveExcerptNote());
      action(t().actionStudyNotes, () => this.plugin.saveStudyItemNotes());
      action(t().actionExportJson, () => this.plugin.exportSession('json'));
      action(t().actionExportHtml, () => this.plugin.exportSession('html'));
      // Meaning is a reveal: folded until the learner chooses to open it, so they can try first.
      const meaning = el(root, 'section', { cls: 'codazo-section' });
      const reveal = el(meaning, 'details', { cls: 'codazo-disclosure codazo-reveal-meaning' });
      el(reveal, 'summary', { text: `${t().meaning} · ${t().revealHint}` });
      if (!session.review.strengths.length) el(reveal, 'p', { cls: 'codazo-muted', text: t().noObservations });
      const list = el(reveal, 'ul');
      for (const item of session.review.strengths) { const li = el(list, 'li', { text: `${item.text} ` }); el(li, 'span', { cls: 'codazo-muted', text: `«${item.anchor.quote}»`, lang: 'es' }); }
      renderStudy(root, session.review, open);
      return;
    }
    if (session.kind === 'study') {
      renderStudySource(root, session.review, select);
      const actions = el(root, 'section', { cls: 'codazo-actions' });
      const action = (label: string, run: () => Promise<void> | void) => { const button = el(actions, 'button', { text: label, attrs: { type: 'button' } }); button.addEventListener('click', () => void run()); };
      action(t().actionSaveStudy, () => this.plugin.saveStudyNote());
      action(t().actionStudyNotes, () => this.plugin.saveStudyItemNotes());
      action(t().actionExportJson, () => this.plugin.exportSession('json'));
      action(t().actionExportHtml, () => this.plugin.exportSession('html'));
      renderStudy(root, session.review, open);
      return;
    }
    renderAnnotatedSource(root, session.review, select);
    const actions = el(root, 'section', { cls: 'codazo-actions' });
    const action = (label: string, run: () => Promise<void> | void) => { const button = el(actions, 'button', { text: label, attrs: { type: 'button' } }); button.addEventListener('click', () => void run()); };
    action(t().actionRevision, () => this.plugin.createRevisionNote());
    action(session.savedReviewPath ? t().actionSaved : t().actionSaveReview, () => this.plugin.saveReviewNote());
    action(t().actionSaveStudy, () => this.plugin.saveStudyNote());
    action(t().actionStudyNotes, () => this.plugin.saveStudyItemNotes());
    action(t().actionExportJson, () => this.plugin.exportSession('json'));
    action(t().actionExportHtml, () => this.plugin.exportSession('html'));

    renderOverview(root, session.review, open);
    const feedback = accordion(root, `${t().observations} (${session.review.annotations.length})`, open);
    el(feedback, 'p', { cls: 'codazo-muted', text: t().observationsIntro });
    if (!session.review.annotations.length) el(feedback, 'p', { text: t().noObservations });
    for (const annotation of session.review.annotations) renderAnnotation(feedback, annotation, live ? () => this.plugin.revealAnnotation(annotation.id) : undefined);
    renderStudy(root, session.review, open);
  }

  /** Everything saved under the Codazo folder, grouped by kind; the active note's items first when a note is open. */
  private renderIndex(root: HTMLElement): void {
    const entries = this.plugin.indexEntries();
    const active = this.plugin.app.workspace.getActiveFile()?.path ?? null;
    const section = el(root, 'section', { cls: 'codazo-section codazo-index' });
    if (!entries.length) { el(section, 'p', { cls: 'codazo-muted', text: t().indexEmpty }); return; }
    const KINDS: IndexKind[] = ['review', 'study', 'excerpt', 'revision', 'palabra', 'verbo'];
    const byKind = (items: IndexEntry[]): [IndexKind, IndexEntry[]][] => KINDS.map(kind => [kind, items.filter(e => e.kind === kind)] as [IndexKind, IndexEntry[]]).filter(([, items]) => items.length > 0);
    const mine = active ? entries.filter(e => e.sourcePath === active) : [];
    const renderGroup = (parent: HTMLElement, kind: IndexKind, items: IndexEntry[], open: boolean) => {
      const body = accordion(parent, `${t().indexKind[kind]} (${items.length})`, open);
      const list = el(body, 'ul', { cls: 'codazo-index-list' });
      for (const entry of items) {
        const li = el(list, 'li', { cls: `codazo-index-item codazo-index-${entry.kind}` });
        const main = el(li, 'div', { cls: 'codazo-index-main' });
        const name = el(main, 'button', { cls: 'codazo-link codazo-index-title', text: entry.title, attrs: { type: 'button', title: entry.loadable ? t().indexLoad : t().indexOpen } });
        name.addEventListener('click', () => entry.loadable ? void this.plugin.loadSavedReview(entry.file) : void this.plugin.app.workspace.getLeaf('tab').openFile(entry.file));
        const meta = [new Date(entry.at).toLocaleDateString(), entry.progress ? `${t().indexProgress}: ${entry.progress}` : null, entry.sourcePath && entry.sourcePath !== active ? entry.sourcePath.replace(/\.md$/, '') : null].filter(Boolean).join(' · ');
        el(main, 'p', { cls: 'codazo-muted codazo-index-meta', text: meta });
        const openButton = el(li, 'button', { cls: 'codazo-index-open', text: t().indexOpen, attrs: { type: 'button' } });
        openButton.addEventListener('click', () => void this.plugin.app.workspace.getLeaf('tab').openFile(entry.file));
      }
    };
    // The open note's own items first, grouped by kind and starting open; then, always labeled, the whole folder.
    el(section, 'p', { cls: 'codazo-eyebrow', text: t().indexThisNote });
    if (mine.length) for (const [kind, items] of byKind(mine)) renderGroup(section, kind, items, true);
    else el(section, 'p', { cls: 'codazo-muted', text: active ? t().indexNoneForNote : t().indexNoNote });
    el(section, 'p', { cls: 'codazo-eyebrow codazo-index-divider', text: t().indexAll });
    for (const [kind, items] of byKind(entries)) renderGroup(section, kind, items, false);
  }
}
