import { App, ButtonComponent, Notice, PluginSettingTab, Setting, type SettingDefinitionItem, type SettingGroupItem } from 'obsidian';
import { describeError } from './labels';
import type CodazoPlugin from './main';
import { DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S, newProfileId, profileLabel, type Profile } from './profiles';
import type { PluginData } from './settings';
import { t } from './strings';

const BLANK = (): Omit<Profile, 'id'> => ({ name: '', provider: 'openai', model: '', tokenLimitField: 'max_completion_tokens', responseFormat: 'json_object', maxOutputTokens: 4096, storage: 'session', timeoutSeconds: DEFAULT_TIMEOUT_S });
type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null;

/** `setDestructive` arrived in Obsidian 1.13; earlier versions get the same styling class directly, without the deprecated `setWarning`. */
function destructive(button: ButtonComponent): ButtonComponent {
  const candidate = button as unknown as { setDestructive?: () => unknown };
  if (typeof candidate.setDestructive === 'function') candidate.setDestructive();
  else button.buttonEl.addClass('mod-warning');
  return button;
}

/** Whether the host has the 1.13 declarative settings API; decided from the runtime prototype, not the installed type definitions. */
const hasDeclarativeSettings = (): boolean => typeof (PluginSettingTab.prototype as unknown as { getSettingDefinitions?: unknown }).getSettingDefinitions === 'function';

/**
 * Provider profiles and vault settings. Several profiles, one active. The key
 * field is write-only and never read back into the form. Persistent keys go
 * to Obsidian Secret Storage, session keys to memory; no plaintext path.
 *
 * Two rendering paths, one set of row builders:
 * - Obsidian 1.13 and later render `getSettingDefinitions()` declaratively
 *   (so Codazo's settings appear in settings search) and never call
 *   `display()`.
 * - Older versions down to the 1.11.5 minimum call `display()`, which
 *   renders the same rows imperatively.
 */
export class CodazoSettingTab extends PluginSettingTab {
  private editing: Editing = null;
  /** Encryption readiness, refreshed on each render; the persistent option is offered only while true. */
  private secure = false;
  constructor(app: App, private readonly plugin: CodazoPlugin) { super(app, plugin); }

  // ----- declarative path (Obsidian ≥ 1.13) -----

  getSettingDefinitions(): SettingDefinitionItem[] {
    const store = this.plugin.profiles;
    const profiles = store.list();
    void this.refreshSecure();
    const profileRows: SettingGroupItem[] = profiles.map(profile => ({ name: profile.name, desc: this.profileDesc(profile), searchable: true, render: (setting: Setting) => { this.profileRow(setting, profile); } }));
    const editorRows: SettingGroupItem[] = this.editing ? this.editorDefinitions() : [];
    return [
      { type: 'group', heading: t().sInterface, items: [
        { name: t().sLanguage, desc: t().sLanguageDesc, control: { type: 'dropdown', key: 'uiLanguage', options: { es: 'Español', en: 'English' } } },
        { name: t().sSectionsOpen, desc: t().sSectionsOpenDesc, control: { type: 'toggle', key: 'sectionsOpen' } },
      ] },
      { type: 'group', heading: t().sProvider, items: [
        { name: t().sActiveProfile, desc: t().sActiveProfileDesc, render: (setting: Setting) => { this.activeProfileRow(setting); } },
        ...profileRows,
        { name: t().sNewProfile, searchable: false, render: (setting: Setting) => { setting.addButton(button => button.setButtonText(t().sNewProfile).setCta().onClick(() => { this.editing = { kind: 'new' }; this.rerender(); })); } },
        ...editorRows,
      ] },
      { type: 'group', heading: t().sVault, items: [
        { name: t().sFolder, desc: t().sFolderDesc, control: { type: 'text', key: 'artifactFolder', placeholder: 'Codazo' } },
        { name: t().sAutoSave, desc: t().sAutoSaveDesc, control: { type: 'toggle', key: 'autoSaveReviews' } },
        { name: t().sAutoStudyNotes, desc: t().sAutoStudyNotesDesc, control: { type: 'toggle', key: 'autoStudyNotes' } },
        { name: t().sPrivacy, desc: t().sPrivacyDesc },
      ] },
    ];
  }

  getControlValue(key: string): unknown {
    const data = this.plugin.data as unknown as Record<string, unknown>;
    return key in data ? data[key] : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const patch = controlPatch(key, value);
    if (!patch) return;
    await this.plugin.updateData(patch);
    if ('uiLanguage' in patch) this.rerender();
  }

  // ----- legacy path (Obsidian 1.11.5 – 1.12) -----

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // Rendering is synchronous; readiness is refreshed first, and a failed probe simply renders without the persistent option.
    this.refreshSecure().catch(() => { this.secure = false; }).finally(() => this.renderLegacy(containerEl));
  }

  private renderLegacy(containerEl: HTMLElement): void {
    containerEl.empty();
    const store = this.plugin.profiles;
    new Setting(containerEl).setName(t().sInterface).setHeading();
    new Setting(containerEl).setName(t().sLanguage).setDesc(t().sLanguageDesc).addDropdown(drop => drop.addOption('es', 'Español').addOption('en', 'English').setValue(this.plugin.data.uiLanguage).onChange(value => { void this.setControlValue('uiLanguage', value); }));
    new Setting(containerEl).setName(t().sSectionsOpen).setDesc(t().sSectionsOpenDesc).addToggle(toggle => toggle.setValue(this.plugin.data.sectionsOpen).onChange(value => { void this.setControlValue('sectionsOpen', value); }));

    new Setting(containerEl).setName(t().sProvider).setHeading();
    this.activeProfileRow(new Setting(containerEl).setName(t().sActiveProfile).setDesc(t().sActiveProfileDesc));
    for (const profile of store.list()) this.profileRow(new Setting(containerEl).setName(profile.name).setDesc(this.profileDesc(profile)), profile);
    new Setting(containerEl).addButton(button => button.setButtonText(t().sNewProfile).setCta().onClick(() => { this.editing = { kind: 'new' }; this.renderLegacy(containerEl); }));
    if (this.editing) for (const item of this.editorDefinitions()) if ('render' in item && item.render) { const row = new Setting(containerEl); if (item.name) row.setName(item.name); if (typeof item.desc === 'string') row.setDesc(item.desc); item.render(row, undefined as never); }

    new Setting(containerEl).setName(t().sVault).setHeading();
    new Setting(containerEl).setName(t().sFolder).setDesc(t().sFolderDesc).addText(text => text.setValue(this.plugin.data.artifactFolder).onChange(value => { void this.setControlValue('artifactFolder', value); }));
    new Setting(containerEl).setName(t().sAutoSave).setDesc(t().sAutoSaveDesc).addToggle(toggle => toggle.setValue(this.plugin.data.autoSaveReviews).onChange(value => { void this.setControlValue('autoSaveReviews', value); }));
    new Setting(containerEl).setName(t().sAutoStudyNotes).setDesc(t().sAutoStudyNotesDesc).addToggle(toggle => toggle.setValue(this.plugin.data.autoStudyNotes).onChange(value => { void this.setControlValue('autoStudyNotes', value); }));
    new Setting(containerEl).setName(t().sPrivacy).setDesc(t().sPrivacyDesc);
  }

  /** Re-render whichever path the host uses: the declarative `update()` on 1.13+, the legacy imperative render before that. */
  private rerender(): void {
    const declarative = this as unknown as { update?: () => void };
    if (hasDeclarativeSettings() && typeof declarative.update === 'function') declarative.update();
    else this.renderLegacy(this.containerEl);
  }

  private async refreshSecure(): Promise<void> { this.secure = await this.plugin.profiles.secureStorageAvailable(); }

  // ----- shared row builders -----

  private profileDesc(profile: Profile): string {
    return `${profileLabel(profile).replace(`${profile.name} · `, '')} · ${profile.storage === 'persistent' ? t().sKeyOnDevice : t().sKeySession}`;
  }

  private activeProfileRow(setting: Setting): void {
    const store = this.plugin.profiles;
    const profiles = store.list();
    setting.addDropdown(drop => {
      drop.addOption('', profiles.length ? t().sNone : t().sCreateOne);
      for (const profile of profiles) drop.addOption(profile.id, profileLabel(profile));
      drop.setValue(store.active()?.id ?? '').onChange(value => { store.setActive(value || null).catch((error: unknown) => new Notice(describeError(error))); });
    });
  }

  private profileRow(setting: Setting, profile: Profile): void {
    const store = this.plugin.profiles;
    void store.hasKey(profile.id).then(has => { if (!has) setting.setDesc(`${this.profileDesc(profile)} · ${t().sNoKeyNow}`); });
    setting.addButton(button => button.setButtonText(t().sEdit).onClick(() => { this.editing = { kind: 'edit', id: profile.id }; this.rerender(); }));
    setting.addButton(button => destructive(button).setButtonText(t().sDelete).onClick(async () => { await store.remove(profile.id); new Notice(t().sForgot(profile.name)); this.editing = null; this.rerender(); }));
  }

  /** The profile editor as render rows, so both paths show the same form. */
  private editorDefinitions(): SettingGroupItem[] {
    const existing = this.editing?.kind === 'edit' ? this.plugin.profiles.get(this.editing.id) : null;
    const draft: Profile = existing ? { ...existing } : { id: newProfileId(), ...BLANK() };
    let apiKey = '';
    let urlSetting: Setting | null = null;
    const secure = this.secure;
    const row = (name: string, desc: string | undefined, render: (setting: Setting) => void): SettingGroupItem => ({ name, ...(desc ? { desc } : {}), searchable: false, render: (setting: Setting) => { render(setting); } });
    return [
      { name: existing ? t().sEditProfile(existing.name) : t().sNewProfile, searchable: false, render: (setting: Setting) => { setting.setHeading(); } },
      row(t().sName, undefined, s => { s.addText(text => text.setPlaceholder(t().sNamePlaceholder).setValue(draft.name).onChange(value => { draft.name = value.trim(); })); }),
      row(t().sService, t().sServiceDesc, s => { s.addDropdown(drop => drop.addOption('openai', 'OpenAI').addOption('ollama', 'Ollama Cloud').addOption('custom', t().sCustom).setValue(draft.provider).onChange(value => { draft.provider = value as Profile['provider']; urlSetting?.settingEl.toggle(draft.provider === 'custom'); })); }),
      row(t().sBaseUrl, t().sBaseUrlDesc, s => { urlSetting = s; s.addText(text => text.setPlaceholder('https://…/v1').setValue(draft.baseURL ?? '').onChange(value => { draft.baseURL = value.trim() || undefined; })); s.settingEl.toggle(draft.provider === 'custom'); }),
      row(t().sModel, t().sModelDesc, s => { s.addText(text => text.setPlaceholder('model-id').setValue(draft.model).onChange(value => { draft.model = value.trim(); })); }),
      row(t().sKey, existing ? t().sKeyDescExisting : t().sKeyDescNew, s => { s.addText(text => { text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.setPlaceholder(existing ? '••••••••' : 'sk-…').onChange(value => { apiKey = value.trim(); }); }); }),
      row(t().sKeyStorage, secure ? t().sKeyStorageDesc : t().sKeyStorageNoSecure, s => { s.addDropdown(drop => { drop.addOption('session', t().sSessionOnly); if (secure) drop.addOption('persistent', t().sOnDevice); drop.setValue(secure ? draft.storage : 'session').onChange(value => { draft.storage = value as Profile['storage']; }); }); }),
      row(t().sTokenField, undefined, s => { s.addDropdown(drop => drop.addOption('max_completion_tokens', 'max_completion_tokens').addOption('max_tokens', 'max_tokens').setValue(draft.tokenLimitField).onChange(value => { draft.tokenLimitField = value as Profile['tokenLimitField']; })); }),
      row(t().sResponseFormat, t().sResponseFormatDesc, s => { s.addDropdown(drop => drop.addOption('json_object', 'json_object').addOption('json_schema', 'json_schema').addOption('prompt', t().sPromptOnly).setValue(draft.responseFormat).onChange(value => { draft.responseFormat = value as Profile['responseFormat']; })); }),
      row(t().sTimeout, t().sTimeoutDesc(5, MAX_TIMEOUT_S, DEFAULT_TIMEOUT_S), s => { s.addText(text => text.setValue(String(draft.timeoutSeconds)).onChange(value => { draft.timeoutSeconds = Number(value); })); }),
      row(t().sMaxTokens, t().sMaxTokensDesc, s => { s.addText(text => text.setValue(String(draft.maxOutputTokens)).onChange(value => { draft.maxOutputTokens = Number(value); })); }),
      row('', undefined, s => { s
        .addButton(button => button.setButtonText(t().cancel).onClick(() => { this.editing = null; this.rerender(); }))
        .addButton(button => button.setButtonText(t().sSaveProfile).setCta().onClick(async () => {
          try {
            const { baseURL, ...rest } = draft;
            const saved = await this.plugin.profiles.save(draft.provider === 'custom' ? { ...rest, baseURL } : rest, apiKey || undefined);
            new Notice(t().sProfileSaved(profileLabel(saved)));
            if (saved.provider === 'custom' && /^http:/i.test(saved.baseURL ?? '')) new Notice(t().noticeCleartextKey, 10000);
            this.editing = null;
            this.rerender();
          } catch (error) { new Notice(describeError(error)); }
        })); }),
    ];
  }
}

/** Map a settings-control key and raw value to a validated plugin-data patch; unknown keys or wrong types are ignored. */
export function controlPatch(key: string, value: unknown): Partial<PluginData> | null {
  switch (key) {
    case 'uiLanguage': return value === 'es' || value === 'en' ? { uiLanguage: value } : null;
    case 'sectionsOpen': return typeof value === 'boolean' ? { sectionsOpen: value } : null;
    case 'artifactFolder': return typeof value === 'string' ? { artifactFolder: value.trim() || 'Codazo' } : null;
    case 'autoSaveReviews': return typeof value === 'boolean' ? { autoSaveReviews: value, ...(value ? { storageDisclosureSeen: true } : {}) } : null;
    case 'autoStudyNotes': return typeof value === 'boolean' ? { autoStudyNotes: value, ...(value ? { storageDisclosureSeen: true } : {}) } : null;
    default: return null;
  }
}
