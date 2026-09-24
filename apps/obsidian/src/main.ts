import { Editor, MarkdownView, Modal, Notice, Plugin, Setting, TFile, addIcon, normalizePath, requireApiVersion, setTooltip } from 'obsidian';
import { REVIEW_EXPORT_FILENAME, REVIEW_JSON_FILENAME, reviewHtml, reviewJson } from '../../../packages/shared/lib/export/download-review';
import { LocalReviewService } from '../../../packages/shared/lib/review/local-review-service';
import { createRequestId } from '../../../packages/shared/lib/review/request-id';
import { resolveAnnotations } from '../../../packages/shared/lib/review/resolve-annotations';
import type { Review } from '../../../packages/shared/lib/review/schema';
import { availablePath, containedFolder, excerptNoteContent, parseSavedReview, reviewNoteContent, revisionNoteContent, sanitizeBasename, studyNoteContent, type ArtifactLinks } from './artifacts';
import { excerptPolicy } from './excerpt';
import { HighlightStore, highlightExtension } from './editor-extension';
import { collectIndex, type IndexEntry } from './index-view';
import { CODAZO_ICON, CODAZO_ICON_ID } from './icon';
import { findIntentCallout, frontmatterEnd, INTENT_PLACEHOLDER, INTENT_PLACEHOLDER_OFFSET, INTENT_TEMPLATE, stripCallout } from './intent';
import { makeGloss, stripGlosses } from './gloss';
import { glossExtension, glossPostProcessor } from './gloss-extension';
import { describeError } from './labels';
import { ReviewModal, type ReviewMode, type ReviewRequestChoice } from './review-modal';
import { STUDY_POLICY } from './study-policy';
import { el } from './render';
import { CodazoReviewView, VIEW_TYPE } from './review-pane';
import { locateSource, sha256Hex, type ReviewSession, type SourceLocation } from './session';
import { ProfileStore, profileFingerprint, profileLabel } from './profiles';
import { createSecretVault, migrateLegacyProvider, parsePluginData, probeSecretEncryption, profileSecretId, recordPersistence, type PluginData } from './settings-runtime';
import { createNodeFetch } from './node-transport';
import { CodazoSettingTab } from './settings-tab';
import { setUiLanguage, t } from './strings';
import { planStudyNotes } from './study-notes';

/** Status bar at the top of the pane. `label` is the active profile (name · destination · model). */
export type PaneStatus = { kind: 'idle' } | { kind: 'in_flight'; label: string; mode: 'review' | 'study' | 'excerpt'; startedAt: number } | { kind: 'error'; message: string; label?: string } | { kind: 'success'; message: string; label: string };
export type Freshness = SourceLocation | { status: 'unavailable' };
export type PaneView = 'result' | 'index';
export type PluginState = { session: ReviewSession | null; status: PaneStatus; freshness: Freshness; view: PaneView };

/**
 * Codazo for Obsidian. The vault is the library; this plugin is an explicit,
 * learner-controlled review layer. Nothing here reads notes in the background,
 * calls a provider without the confirmation modal, or edits the source note.
 */
export default class CodazoPlugin extends Plugin {
  data: PluginData = parsePluginData(null);
  profiles!: ProfileStore;
  service!: LocalReviewService;
  state: PluginState = { session: null, status: { kind: 'idle' }, freshness: { status: 'unavailable' }, view: 'result' };
  private highlights = new HighlightStore();
  private activeRequestId: string | null = null;
  /** One in-memory session per note, keyed by path; the pane follows the active note. Bounded; nothing persists. */
  private sessions = new Map<string, ReviewSession>();
  private static readonly MAX_SESSIONS = 50;

  async onload(): Promise<void> {
    this.data = parsePluginData(await this.loadData());
    setUiLanguage(this.data.uiLanguage);
    const secretStorage = requireApiVersion('1.11.5') ? this.app.secretStorage : undefined;
    const webStorage = typeof localStorage === 'undefined' ? undefined : localStorage;
    const encrypted = secretStorage ? probeSecretEncryption(secretStorage, webStorage) : false;
    if (this.data.profiles === null && this.data.provider !== null) {
      // Move the single provider of earlier builds into the first profile; the old secret follows it.
      const legacyVault = createSecretVault(secretStorage, undefined, webStorage);
      const migrated = migrateLegacyProvider(this.data.provider, encrypted ? await legacyVault.read() : null);
      if (migrated?.secret) { await createSecretVault(secretStorage, profileSecretId('default'), webStorage).write(migrated.secret); await legacyVault.remove(); }
      await this.writeData({ ...this.data, provider: null, profiles: migrated?.profiles ?? null });
    }
    this.profiles = new ProfileStore(recordPersistence('profiles', () => this.data, next => this.writeData(next)), id => createSecretVault(secretStorage, profileSecretId(id), webStorage), async () => secretStorage !== undefined && probeSecretEncryption(secretStorage, webStorage));
    await this.profiles.load();
    // Desktop-only release: Node's http client never follows redirects, so a key and text can only reach the confirmed destination. No weaker fallback.
    const transport = createNodeFetch();
    this.service = new LocalReviewService(this.profiles, transport ?? (async () => { throw new Error('TRANSPORT_UNAVAILABLE'); }));
    if (!transport) new Notice(t().noticeTransportUnavailable, 10000);

    addIcon(CODAZO_ICON_ID, CODAZO_ICON);
    this.registerView(VIEW_TYPE, leaf => new CodazoReviewView(leaf, this));
    this.addRibbonIcon(CODAZO_ICON_ID, 'Codazo', () => void this.openPane());
    this.registerEditorExtension(highlightExtension(this.highlights));
    this.registerEditorExtension(glossExtension());
    this.registerMarkdownPostProcessor(element => glossPostProcessor(element, (el, text) => setTooltip(el, text)));
    this.addSettingTab(new CodazoSettingTab(this.app, this));

    this.registerCommands();

    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file) return;
      const file = view.file;
      const selected = editor.getSelection().length > 0;
      // Two sections, both under the Codazo icon: Interpretación sends text to the model; Herramientas never does.
      const interpret = (title: string, icon: string, run: () => void) => menu.addItem(item => item.setSection('codazo-interpretation').setTitle(title).setIcon(icon).setDisabled(!selected).onClick(run));
      const tool = (title: string, icon: string, run: () => void) => menu.addItem(item => item.setSection('codazo-tools').setTitle(title).setIcon(icon).onClick(run));
      menu.addItem(item => item.setSection('codazo-interpretation').setTitle(`Codazo: ${t().menuInterpretation}`).setIsLabel(true));
      interpret(t().menuReview, 'pencil-line', () => this.openReviewModal(editor, file, 'selection', 'review'));
      interpret(t().menuStudy, 'book-open', () => this.openReviewModal(editor, file, 'selection', 'study'));
      interpret(t().menuExcerpt, 'quote', () => this.openReviewModal(editor, file, 'selection', 'excerpt'));
      menu.addItem(item => item.setSection('codazo-tools').setTitle(`Codazo: ${t().menuTools}`).setIsLabel(true));
      if (selected) tool(t().cmdAddGloss, 'languages', () => this.addGloss(editor));
      tool(t().menuInsertIntent, 'message-square-text', () => this.insertIntentCallout(editor));
      tool(t().cmdOpenPane, 'panel-right', () => void this.openPane());
      tool(t().cmdOpenIndex, 'list', () => { this.setState({ view: 'index' }); void this.openPane(); });
    }));
    this.registerVaultEvents();
  }

  /** Ask for the English of the selected word or phrase and wrap the selection as `{term|gloss}`. */
  private addGloss(editor: Editor): void {
    const term = editor.getSelection();
    if (!term.trim()) return;
    const modal = new Modal(this.app);
    modal.setTitle(t().glossTitle);
    let gloss = '';
    el(modal.contentEl, 'p', { cls: 'codazo-quote', text: `«${term.trim()}»`, lang: 'es' });
    new Setting(modal.contentEl).setName(t().glossMeaning).setDesc(t().glossDesc).addText(text => { text.setPlaceholder('boots'); text.onChange(value => { gloss = value; }); text.inputEl.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }); window.setTimeout(() => text.inputEl.focus(), 0); });
    const apply = () => { if (!gloss.trim()) return; editor.replaceSelection(makeGloss(term, gloss)); modal.close(); };
    new Setting(modal.contentEl).addButton(button => button.setButtonText(t().cancel).onClick(() => modal.close())).addButton(button => button.setButtonText(t().glossAdd).setCta().onClick(apply));
    modal.open();
  }

  /** Insert the English-intent callout at the cursor with its placeholder selected, then two blank lines. One per note. */
  private insertIntentCallout(editor: Editor): void {
    if (findIntentCallout(editor.getValue()) || editor.getValue().includes(INTENT_PLACEHOLDER)) { new Notice(t().noticeIntentExists); return; }
    const from = editor.getCursor('from');
    const atLineStart = from.ch === 0;
    const prefix = atLineStart ? '' : '\n';
    const start = editor.posToOffset(from);
    editor.replaceRange(prefix + INTENT_TEMPLATE, from, editor.getCursor('to'));
    const placeholderStart = start + prefix.length + INTENT_PLACEHOLDER_OFFSET;
    editor.setSelection(editor.offsetToPos(placeholderStart), editor.offsetToPos(placeholderStart + INTENT_PLACEHOLDER.length));
  }

  /** Command names follow the interface language; re-registering with the same ids replaces them. */
  private registerCommands(): void {
    this.addCommand({ id: 'review-selection', name: t().cmdReviewSelection, editorCheckCallback: (checking, editor, view) => {
      const file = view instanceof MarkdownView ? view.file : null;
      if (!file || editor.getSelection().length === 0) return false;
      if (!checking) this.openReviewModal(editor, file, 'selection', 'review');
      return true;
    } });
    this.addCommand({ id: 'study-selection', name: t().cmdStudySelection, editorCheckCallback: (checking, editor, view) => {
      const file = view instanceof MarkdownView ? view.file : null;
      if (!file || editor.getSelection().length === 0) return false;
      if (!checking) this.openReviewModal(editor, file, 'selection', 'study');
      return true;
    } });
    this.addCommand({ id: 'excerpt-selection', name: t().cmdExcerpt, editorCheckCallback: (checking, editor, view) => {
      const file = view instanceof MarkdownView ? view.file : null;
      if (!file || editor.getSelection().length === 0) return false;
      if (!checking) this.openReviewModal(editor, file, 'selection', 'excerpt');
      return true;
    } });
    this.addCommand({ id: 'add-gloss', name: t().cmdAddGloss, editorCheckCallback: (checking, editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file || editor.getSelection().trim().length === 0) return false;
      if (!checking) this.addGloss(editor);
      return true;
    } });
    this.addCommand({ id: 'insert-intent', name: t().cmdInsertIntent, editorCheckCallback: (checking, editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file) return false;
      if (!checking) this.insertIntentCallout(editor);
      return true;
    } });
    this.addCommand({ id: 'review-note', name: t().cmdReviewNote, editorCheckCallback: (checking, editor, view) => {
      const file = view instanceof MarkdownView ? view.file : null;
      if (!file || editor.getValue().trim().length === 0) return false;
      if (!checking) this.openReviewModal(editor, file, 'note', 'review');
      return true;
    } });
    this.addCommand({ id: 'open-pane', name: t().cmdOpenPane, callback: () => void this.openPane() });
    this.addCommand({ id: 'open-index', name: t().cmdOpenIndex, callback: () => { this.setState({ view: 'index' }); void this.openPane(); } });
    this.addCommand({ id: 'load-saved-review', name: t().cmdLoadSaved, checkCallback: checking => {
      const file = this.app.workspace.getActiveFile();
      const cache = file ? this.app.metadataCache.getFileCache(file) : null;
      const kind = cache?.frontmatter?.['codazo-kind'];
      if (!file || (kind !== 'review' && kind !== 'study' && kind !== 'excerpt')) return false;
      if (!checking) void this.loadSavedReview(file);
      return true;
    } });
    const withSession = (id: string, name: string, run: () => Promise<void>) => this.addCommand({ id, name, checkCallback: checking => { if (!this.state.session) return false; if (!checking) void run(); return true; } });
    withSession('create-revision', t().cmdCreateRevision, () => this.createRevisionNote());
    withSession('save-review', t().cmdSaveReview, () => this.saveReviewNote());
    withSession('save-study', t().cmdSaveStudy, () => this.saveStudyNote());
    withSession('export-json', t().cmdExportJson, () => this.exportSession('json'));
    withSession('export-html', t().cmdExportHtml, () => this.exportSession('html'));
    withSession('save-study-notes', t().actionStudyNotes, () => this.saveStudyItemNotes());
    this.addCommand({ id: 'cancel-review', name: t().cmdCancel, checkCallback: checking => { if (this.state.status.kind !== 'in_flight') return false; if (!checking) this.cancelReview(); return true; } });
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on('modify', file => { if (this.state.session && file.path === this.state.session.notePath) void this.refreshFreshness(); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const session = this.sessions.get(oldPath);
      if (!session) return;
      this.sessions.delete(oldPath); session.notePath = file.path; this.sessions.set(file.path, session);
      this.rerender();
    }));
    this.registerEvent(this.app.vault.on('delete', file => { if (this.sessions.delete(file.path) && this.state.session?.notePath === file.path) this.setState({ session: null, freshness: { status: 'unavailable' } }); }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => void this.syncToActiveNote()));
    this.registerEvent(this.app.workspace.on('file-open', () => void this.syncToActiveNote()));
  }

  onunload(): void {
    this.service.dispose();
    this.highlights.current = null;
    this.sessions.clear();
  }

  /** Show the session for the note in the active Markdown view. Clicking into the pane itself keeps the current session. */
  private async syncToActiveNote(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    const next = this.sessions.get(view.file.path) ?? await this.restoreLatestReview(view.file);
    if (this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path !== view.file.path) return;
    if (next !== this.state.session) this.setState({ session: next, status: this.state.status.kind === 'in_flight' ? this.state.status : { kind: 'idle' }, freshness: { status: 'unavailable' }, view: this.state.view === 'index' ? 'index' : 'result' });
    await this.refreshFreshness();
  }

  private remember(session: ReviewSession): void {
    this.sessions.delete(session.notePath);
    this.sessions.set(session.notePath, session);
    while (this.sessions.size > CodazoPlugin.MAX_SESSIONS) { const oldest = this.sessions.keys().next().value; if (oldest === undefined) break; this.sessions.delete(oldest); }
  }

  // ----- data -----

  private async writeData(next: PluginData): Promise<void> { this.data = next; await this.saveData(next); }
  async updateData(patch: Partial<PluginData>): Promise<void> {
    await this.writeData({ ...this.data, ...patch });
    if (patch.uiLanguage) { setUiLanguage(patch.uiLanguage); this.registerCommands(); }
    if (patch.uiLanguage || patch.sectionsOpen !== undefined) this.rerender();
  }

  // ----- review -----

  private openReviewModal(editor: Editor, file: TFile, scope: 'selection' | 'note', mode: ReviewMode): void {
    if (this.state.status.kind === 'in_flight') { new Notice(describeError(new Error('IN_FLIGHT'))); return; }
    // An English-intent callout anywhere in the note prefills the intent and is removed from the text to send.
    // Whole-note mode never sends the note's properties: the frontmatter block is removed before preview and dispatch, and intent discovery skips it too.
    const whole = editor.getValue();
    const callout = findIntentCallout(whole);
    const bodyStart = scope === 'note' ? (frontmatterEnd(whole) ?? 0) : 0;
    const raw = { text: scope === 'selection' ? editor.getSelection() : whole.slice(bodyStart), offset: scope === 'selection' ? editor.posToOffset(editor.getCursor('from')) : bodyStart };
    const stripped = callout ? stripCallout(raw.text, raw.offset, callout) : raw;
    // Glosses are English for the reader; the model gets the Spanish alone. Removing them shifts offsets, so marks may report stale on glossed passages.
    const text = stripGlosses(stripped.text);
    const offset = stripped.offset;
    const active = this.profiles.active();
    const profile = active ? { id: active.id, fingerprint: profileFingerprint(active), label: profileLabel(active) } : null;
    new ReviewModal(this.app, { text, scope, mode, profile, level: this.data.level, intent: callout?.intent, onConfirm: choice => void this.runReview(choice, file, offset) }).open();
  }

  private async runReview(choice: ReviewRequestChoice, file: TFile, offset: number): Promise<void> {
    if (this.state.status.kind === 'in_flight') return;
    // Dispatch goes to the profile the learner confirmed, resolved by id and fingerprint at send time; not to whatever is active now.
    const profile = this.profiles.get(choice.profile.id);
    if (!profile || profileFingerprint(profile) !== choice.profile.fingerprint) { this.setState({ status: { kind: 'error', message: describeError(new Error('PROFILE_CHANGED')), label: choice.profile.label } }); return; }
    if (choice.level !== this.data.level) await this.updateData({ level: choice.level });
    const requestId = createRequestId();
    this.activeRequestId = requestId;
    const label = profileLabel(profile);
    const startedAt = Date.now();
    this.setState({ status: { kind: 'in_flight', label, mode: choice.mode, startedAt } });
    await this.openPane();
    try {
      const sourceHash = await sha256Hex(choice.source.text);
      const result = await this.service.review({ schema_version: 'codazo.request/1', request_id: requestId, revision: 0, source: choice.source, level: choice.level, locale: 'es-MX' }, choice.mode === 'study' ? STUDY_POLICY : choice.mode === 'excerpt' ? excerptPolicy(choice.excerptKind ?? 'phrase') : undefined, this.profiles.bound(choice.profile.id, choice.profile.fingerprint));
      const session: ReviewSession = { id: requestId, kind: choice.mode, ...(choice.mode === 'excerpt' ? { excerptKind: choice.excerptKind ?? 'phrase' } : {}), notePath: file.path, source: choice.source, sourceHash, offset, reviewedAt: new Date().toISOString(), review: result.review, generatedBy: result.generatedBy, provider: profile.provider === 'custom' ? new URL(profile.baseURL!).host : profile.provider, model: profile.model };
      this.remember(session);
      const active = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
      const done = { kind: 'success' as const, label, message: t().statusDone(choice.mode, Math.round((Date.now() - startedAt) / 1000)) };
      if (active === undefined || active === file.path) { this.setState({ session, status: done, freshness: { status: 'fresh', offset }, view: 'result' }); await this.refreshFreshness(); }
      else this.setState({ status: done, view: 'result' });
      // An excerpt exists to become a note; it is always saved. Reviews and study guides follow the setting.
      if (session.kind === 'excerpt') await this.saveExcerptNote(session);
      else if (this.data.autoSaveReviews) await (session.kind === 'study' ? this.saveStudyNote(session) : this.saveReviewNote(session));
      if (this.data.autoStudyNotes) await this.saveStudyItemNotes(session);
    } catch (error) {
      this.setState({ status: { kind: 'error', message: describeError(error), label } });
    } finally { this.activeRequestId = null; }
  }

  cancelReview(): void {
    if (this.activeRequestId) this.service.cancel({ requestId: this.activeRequestId });
  }

  dismissStatus(): void { if (this.state.status.kind !== 'in_flight') this.setState({ status: { kind: 'idle' } }); }

  /** Load a saved review, study sheet, or excerpt into the pane from its note; the payload is re-validated first. No provider call. */
  async loadSavedReview(file: TFile): Promise<void> {
    const parsed = parseSavedReview(await this.app.vault.cachedRead(file));
    if (!parsed.ok && parsed.error === 'NO_PAYLOAD') {
      // Notes saved before payloads existed (early study sheets) cannot be reloaded; open them as notes instead of failing.
      new Notice(t().noticeNoPayload);
      await this.app.workspace.getLeaf('tab').openFile(file);
      return;
    }
    const session = await this.sessionFromSavedReview(file);
    if (!session) { this.setState({ status: { kind: 'error', message: t().noticeSavedInvalid }, view: 'result' }); await this.openPane(); return; }
    this.remember(session);
    this.setState({ session, status: { kind: 'idle' }, freshness: { status: 'unavailable' }, view: 'result' });
    await this.openPane();
    await this.refreshFreshness();
  }

  /** Re-validate a saved review note and rebuild a session from it; null when the payload is missing or invalid. */
  private async sessionFromSavedReview(file: TFile): Promise<ReviewSession | null> {
    const parsed = parseSavedReview(await this.app.vault.cachedRead(file));
    if (!parsed.ok) return null;
    const { review, kind, excerptKind, sourceHash, sessionId, provider, model, reviewedAt } = parsed.value;
    const sourceFile = this.sourceOfSavedReview(file);
    return {
      id: sessionId ?? createRequestId(), kind, ...(kind === 'excerpt' && (excerptKind === 'word' || excerptKind === 'phrase' || excerptKind === 'paragraph') ? { excerptKind } : {}), notePath: sourceFile?.path ?? file.path, source: review.source, sourceHash: sourceHash ?? await sha256Hex(review.source.text), offset: null,
      reviewedAt: reviewedAt ?? new Date(file.stat.ctime).toISOString(), review, generatedBy: `${t().savedReviewLabel}${provider && model ? ` · ${provider} · ${model}` : ''}; AI may be wrong`, provider: provider ?? t().unknown, model: model ?? t().unknown,
      savedReviewPath: file.path,
    };
  }

  private sourceOfSavedReview(reviewFile: TFile): TFile | null {
    const link = this.app.metadataCache.getFileCache(reviewFile)?.frontmatter?.['codazo-source'];
    if (typeof link !== 'string') return null;
    return this.app.metadataCache.getFirstLinkpathDest(link.replace(/^\[\[|\]\]$/g, '').split('|')[0]!, reviewFile.path);
  }

  /**
   * The newest saved review whose codazo-source property points at this note.
   * Looks only inside the configured Reviews folder, through the metadata
   * cache; the one file read is the payload of the chosen note.
   */
  private async restoreLatestReview(note: TFile): Promise<ReviewSession | null> {
    let folderPath: string;
    try { folderPath = containedFolder(`${this.data.artifactFolder}/Reviews`); } catch { return null; }
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return null;
    let best: { file: TFile; at: string } | null = null;
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'md') continue;
      const frontmatter = this.app.metadataCache.getFileCache(child)?.frontmatter;
      if (frontmatter?.['codazo-kind'] !== 'review' || this.sourceOfSavedReview(child)?.path !== note.path) continue;
      const at = typeof frontmatter['codazo-reviewed-at'] === 'string' ? frontmatter['codazo-reviewed-at'] : new Date(child.stat.ctime).toISOString();
      if (!best || at > best.at) best = { file: child, at };
    }
    if (!best) return null;
    const session = await this.sessionFromSavedReview(best.file);
    if (session) this.remember(session);
    return session;
  }

  /** Everything Codazo has saved under its folder, newest first. Metadata cache only. */
  indexEntries(): IndexEntry[] {
    try { return collectIndex(this.app, containedFolder(this.data.artifactFolder)); } catch { return []; }
  }

  showView(view: PaneView): void { this.setState({ view }); }

  // ----- freshness and navigation -----

  private async refreshFreshness(): Promise<void> {
    const session = this.state.session;
    if (!session) { this.highlights.current = null; this.app.workspace.updateOptions(); return; }
    const file = this.app.vault.getFileByPath(session.notePath);
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!file) { this.setState({ freshness: { status: 'unavailable' } }); this.highlights.current = null; this.app.workspace.updateOptions(); return; }
    const text = active?.file?.path === file.path ? active.editor.getValue() : await this.app.vault.cachedRead(file);
    const location = locateSource(text, session.source.text, session.offset);
    if (location.status !== 'stale' && location.offset !== session.offset) session.offset = location.offset;
    const resolved = location.status === 'stale' ? null : resolveAnnotations(session.source.text, session.review.annotations);
    this.highlights.current = resolved?.ok && location.status !== 'stale' ? { sourceText: session.source.text, offset: location.offset, spans: resolved.value.map(span => ({ from: span.start, to: span.end, category: span.annotation.category })) } : null;
    this.app.workspace.updateOptions();
    this.setState({ freshness: location });
  }

  revealAnnotation(id: string): void {
    const session = this.state.session;
    if (!session || this.state.freshness.status === 'stale' || this.state.freshness.status === 'unavailable') return;
    const resolved = resolveAnnotations(session.source.text, session.review.annotations);
    const span = resolved.ok ? resolved.value.find(item => item.id === id) : undefined;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!span || !view || view.file?.path !== session.notePath) { new Notice(t().noticeOpenSource); return; }
    const base = this.state.freshness.offset;
    const from = view.editor.offsetToPos(base + span.start);
    const to = view.editor.offsetToPos(base + span.end);
    view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
  }

  // ----- artifacts -----

  private async ensureDisclosure(): Promise<boolean> {
    if (this.data.storageDisclosureSeen) return true;
    new Notice(t().noticeDisclosure, 8000);
    await this.updateData({ storageDisclosureSeen: true });
    return true;
  }

  private links(session: ReviewSession): ArtifactLinks {
    const source = this.app.vault.getFileByPath(session.notePath);
    const review = session.savedReviewPath ? this.app.vault.getFileByPath(session.savedReviewPath) : null;
    return { source: source ? this.app.fileManager.generateMarkdownLink(source, '') : `[[${session.notePath.replace(/\.md$/, '')}]]`, ...(review ? { review: this.app.fileManager.generateMarkdownLink(review, '') } : {}) };
  }

  private async createArtifact(subfolder: string, basename: string, content: string): Promise<TFile | null> {
    try {
      const folder = containedFolder(`${this.data.artifactFolder}/${subfolder}`);
      if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
      const path = normalizePath(availablePath(candidate => this.app.vault.getAbstractFileByPath(candidate) !== null, folder, basename));
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error('NO_AVAILABLE_PATH');
      const file = await this.app.vault.create(path, content);
      new Notice(t().noticeCreated(file.path));
      return file;
    } catch (error) { new Notice(describeError(error)); return null; }
  }

  private sourceBasename(session: ReviewSession): string { return sanitizeBasename(session.notePath.replace(/\.md$/, '').split('/').pop() ?? 'Nota'); }
  private stamp(session: ReviewSession): string { return session.reviewedAt.slice(0, 16).replace('T', ' ').replace(':', ''); }

  async saveReviewNote(target?: ReviewSession): Promise<void> {
    const session = target ?? this.state.session; if (!session || !(await this.ensureDisclosure())) return;
    if (session.savedReviewPath && this.app.vault.getFileByPath(session.savedReviewPath)) { new Notice(t().noticeAlreadySaved(session.savedReviewPath)); return; }
    const file = await this.createArtifact('Reviews', `${this.sourceBasename(session)} · Codazo ${this.stamp(session)}`, reviewNoteContent(session, this.links(session)));
    if (file) { session.savedReviewPath = file.path; this.rerender(); }
  }

  async createRevisionNote(): Promise<void> {
    const session = this.state.session; if (!session || !(await this.ensureDisclosure())) return;
    const file = await this.createArtifact('Revisions', `${this.sourceBasename(session)} · Mi revisión ${this.stamp(session)}`, revisionNoteContent(session, this.links(session), 1));
    if (file) await this.app.workspace.getLeaf('tab').openFile(file);
  }

  async saveExcerptNote(target?: ReviewSession): Promise<void> {
    const session = target ?? this.state.session; if (!session || !(await this.ensureDisclosure())) return;
    if (session.savedReviewPath && this.app.vault.getFileByPath(session.savedReviewPath)) { new Notice(t().noticeAlreadySaved(session.savedReviewPath)); return; }
    const head = sanitizeBasename(session.source.text.trim().split(/\s+/).slice(0, 6).join(' '));
    const file = await this.createArtifact('Extractos', `${head} · ${this.sourceBasename(session)} ${this.stamp(session)}`, excerptNoteContent(session, this.links(session)));
    if (file) { session.savedReviewPath = file.path; this.rerender(); }
  }

  async saveStudyNote(target?: ReviewSession): Promise<void> {
    const session = target ?? this.state.session; if (!session || !(await this.ensureDisclosure())) return;
    await this.createArtifact('Study', `${this.sourceBasename(session)} · Estudio ${this.stamp(session)}`, studyNoteContent(session, this.links(session)));
  }

  /** One note per word and per verb-tense; existing notes are left exactly as they are. */
  async saveStudyItemNotes(target?: ReviewSession): Promise<void> {
    const session = target ?? this.state.session; if (!session || !(await this.ensureDisclosure())) return;
    try {
      const root = containedFolder(this.data.artifactFolder);
      const plans = planStudyNotes(session.review, session, root, this.links(session).source);
      let created = 0; let existing = 0;
      for (const plan of plans) {
        const path = normalizePath(plan.path);
        if (this.app.vault.getAbstractFileByPath(path)) { existing++; continue; }
        const folder = path.slice(0, path.lastIndexOf('/'));
        if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
        await this.app.vault.create(path, plan.content);
        created++;
      }
      new Notice(t().noticeStudyNotes(created, existing));
    } catch (error) { new Notice(describeError(error)); }
  }

  async exportSession(format: 'json' | 'html'): Promise<void> {
    const session = this.state.session; if (!session || !(await this.ensureDisclosure())) return;
    const review: Review = session.review;
    const content = format === 'json' ? reviewJson(review) : reviewHtml(review, { generatedBy: session.generatedBy });
    const name = `${this.sourceBasename(session)} · ${format === 'json' ? REVIEW_JSON_FILENAME : REVIEW_EXPORT_FILENAME}`;
    try {
      const folder = containedFolder(`${this.data.artifactFolder}/Exports`);
      if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
      let path = normalizePath(`${folder}/${sanitizeBasename(name.replace(/\.(json|html)$/, ''))}.${format}`);
      for (let n = 2; this.app.vault.getAbstractFileByPath(path) && n < 10_000; n++) path = normalizePath(`${folder}/${sanitizeBasename(name.replace(/\.(json|html)$/, ''))} ${n}.${format}`);
      const file = await this.app.vault.create(path, content);
      new Notice(t().noticeExported(file.path));
    } catch (error) { new Notice(describeError(error)); }
  }

  // ----- pane -----

  async openPane(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
    this.rerender();
  }

  private setState(patch: Partial<PluginState>): void { this.state = { ...this.state, ...patch }; this.rerender(); }
  private rerender(): void { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof CodazoReviewView) leaf.view.render(); }
}
