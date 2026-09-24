import { App, Modal, Setting } from 'obsidian';
import { codePointLength, LIMITS } from '../shared/lib/review/limits';
import type { ReviewSource } from '../shared/lib/review/schema';
import { LEVELS } from './labels';
import { detectExcerptKind, type ExcerptKind } from './excerpt';
import { el } from './render';
import { t } from './strings';

export type ReviewMode = 'review' | 'study' | 'excerpt';
/** The learner's confirmation, bound to the exact profile shown in the dialog. */
export type ConfirmedProfile = { id: string; fingerprint: string; label: string };
export type ReviewRequestChoice = { source: ReviewSource; level: (typeof LEVELS)[number]; mode: ReviewMode; excerptKind?: ExcerptKind; profile: ConfirmedProfile };

/**
 * The only door to a provider call. Shows the exact text that will be sent,
 * names the provider and model, takes optional English intent, and requires
 * the explicit "Revisar" action. Nothing is dispatched by opening it.
 */
export class ReviewModal extends Modal {
  constructor(app: App, private readonly options: { text: string; scope: 'selection' | 'note'; mode: ReviewMode; profile: ConfirmedProfile | null; level: (typeof LEVELS)[number]; intent?: string; onConfirm: (choice: ReviewRequestChoice) => void }) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    const study = this.options.mode === 'study';
    const excerpt = this.options.mode === 'excerpt';
    this.setTitle(excerpt ? t().modalTitleExcerpt : study ? t().modalTitleStudy : this.options.scope === 'selection' ? t().modalTitleSelection : t().modalTitleNote);
    if (study) el(contentEl, 'p', { text: t().modalStudyIntro });
    if (excerpt) el(contentEl, 'p', { text: t().modalExcerptIntro });
    let excerptKind: ExcerptKind = detectExcerptKind(this.options.text);
    if (excerpt) new Setting(contentEl).setName(t().modalExcerptKind).setDesc(t().modalExcerptKindDesc).addDropdown(drop => { drop.addOption('word', t().excerptWord).addOption('phrase', t().excerptPhrase).addOption('paragraph', t().excerptParagraph).setValue(excerptKind).onChange(value => { excerptKind = value as ExcerptKind; }); });
    const length = codePointLength(this.options.text);
    const tooLong = length > LIMITS.sourceCodePoints || this.options.text.trim().length === 0;
    el(contentEl, 'p', { text: t().modalExactText });
    el(contentEl, 'pre', { cls: 'codazo-preview', text: this.options.text, lang: 'es', attrs: { 'aria-label': t().modalTextAria } });
    el(contentEl, 'p', { cls: tooLong ? 'codazo-warning' : 'codazo-muted', text: tooLong ? t().modalTooLong(length, LIMITS.sourceCodePoints) : t().modalChars(length) });
    let intent = this.options.intent ?? '';
    let level = this.options.level;
    if (!study && !excerpt) new Setting(contentEl).setName(t().modalIntent).setDesc(this.options.intent ? t().modalIntentFromNote : t().modalIntentDesc).addTextArea(area => { area.setPlaceholder(t().modalIntentPlaceholder); area.setValue(intent); area.onChange(value => { intent = value; }); });
    new Setting(contentEl).setName(study || excerpt ? t().modalLevelStudy : t().modalLevel).addDropdown(drop => { for (const item of LEVELS) drop.addOption(item, item); drop.setValue(level); drop.onChange(value => { level = value as (typeof LEVELS)[number]; }); });
    el(contentEl, 'p', { cls: 'codazo-muted', text: this.options.profile ? t().modalProvider(this.options.profile.label) : t().modalNoProvider });
    new Setting(contentEl)
      .addButton(button => button.setButtonText(t().cancel).onClick(() => this.close()))
      .addButton(button => {
        button.setButtonText(excerpt ? t().modalConfirmExcerpt : study ? t().modalConfirmStudy : t().modalConfirmReview).setCta().setDisabled(tooLong || this.options.profile === null);
        button.onClick(() => {
          const trimmedIntent = intent.trim();
          if (trimmedIntent.length && codePointLength(trimmedIntent) > LIMITS.intentCodePoints) return;
          const source: ReviewSource = trimmedIntent.length && !study && !excerpt ? { text: this.options.text, mode: 'intent_comparison', intent: trimmedIntent } : { text: this.options.text, mode: 'spanish_only' };
          if (!this.options.profile) return;
          this.close();
          this.options.onConfirm({ source, level, mode: this.options.mode, ...(excerpt ? { excerptKind } : {}), profile: this.options.profile });
        });
      });
  }

  onClose(): void { this.contentEl.empty(); }
}
