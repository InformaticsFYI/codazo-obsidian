import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { describeError } from './labels';
import type CodazoPlugin from './main';
import { DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S, newProfileId, profileLabel, type Profile } from './profiles';
import { t, type UiLanguage } from './strings';

const BLANK = (): Omit<Profile, 'id'> => ({ name: '', provider: 'openai', model: '', tokenLimitField: 'max_completion_tokens', responseFormat: 'json_object', maxOutputTokens: 4096, storage: 'session', timeoutSeconds: DEFAULT_TIMEOUT_S });

/**
 * Provider profiles and vault settings. Several profiles, one active. The key
 * field is write-only and never read back into the form. Persistent keys go
 * to Obsidian Secret Storage, session keys to memory; no plaintext path.
 */
export class CodazoSettingTab extends PluginSettingTab {
  private editing: string | 'new' | null = null;
  constructor(app: App, private readonly plugin: CodazoPlugin) { super(app, plugin); }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    const store = this.plugin.profiles;
    const profiles = store.list();
    const secure = await store.secureStorageAvailable();

    new Setting(containerEl).setName(t().sInterface).setHeading();
    new Setting(containerEl).setName(t().sLanguage).setDesc(t().sLanguageDesc).addDropdown(drop => drop.addOption('es', 'Español').addOption('en', 'English').setValue(this.plugin.data.uiLanguage).onChange(async value => { await this.plugin.updateData({ uiLanguage: value as UiLanguage }); await this.display(); }));

    new Setting(containerEl).setName(t().sSectionsOpen).setDesc(t().sSectionsOpenDesc).addToggle(toggle => toggle.setValue(this.plugin.data.sectionsOpen).onChange(async value => { await this.plugin.updateData({ sectionsOpen: value }); }));

    new Setting(containerEl).setName(t().sProvider).setHeading();
    new Setting(containerEl).setName(t().sActiveProfile).setDesc(t().sActiveProfileDesc).addDropdown(drop => {
      drop.addOption('', profiles.length ? t().sNone : t().sCreateOne);
      for (const profile of profiles) drop.addOption(profile.id, profileLabel(profile));
      drop.setValue(store.active()?.id ?? '').onChange(async value => { try { await store.setActive(value || null); } catch (error) { new Notice(describeError(error)); } });
    });
    for (const profile of profiles) {
      const row = new Setting(containerEl).setName(profile.name).setDesc(`${profileLabel(profile).replace(`${profile.name} · `, '')} · ${profile.storage === 'persistent' ? t().sKeyOnDevice : t().sKeySession}${(await store.hasKey(profile.id)) ? '' : ` · ${t().sNoKeyNow}`}`);
      row.addButton(button => button.setButtonText(t().sEdit).onClick(async () => { this.editing = profile.id; await this.display(); }));
      row.addButton(button => button.setButtonText(t().sDelete).setWarning().onClick(async () => { await store.remove(profile.id); new Notice(t().sForgot(profile.name)); await this.display(); }));
    }
    new Setting(containerEl).addButton(button => button.setButtonText(t().sNewProfile).setCta().onClick(async () => { this.editing = 'new'; await this.display(); }));

    if (this.editing !== null) this.renderEditor(containerEl, this.editing === 'new' ? null : store.get(this.editing), secure);

    new Setting(containerEl).setName(t().sVault).setHeading();
    new Setting(containerEl).setName(t().sFolder).setDesc(t().sFolderDesc).addText(text => text.setValue(this.plugin.data.artifactFolder).onChange(async value => { await this.plugin.updateData({ artifactFolder: value.trim() || 'Codazo' }); }));
    new Setting(containerEl).setName(t().sAutoSave).setDesc(t().sAutoSaveDesc).addToggle(toggle => toggle.setValue(this.plugin.data.autoSaveReviews).onChange(async value => { await this.plugin.updateData({ autoSaveReviews: value, ...(value ? { storageDisclosureSeen: true } : {}) }); }));
    new Setting(containerEl).setName(t().sAutoStudyNotes).setDesc(t().sAutoStudyNotesDesc).addToggle(toggle => toggle.setValue(this.plugin.data.autoStudyNotes).onChange(async value => { await this.plugin.updateData({ autoStudyNotes: value, ...(value ? { storageDisclosureSeen: true } : {}) }); }));
    new Setting(containerEl).setName(t().sPrivacy).setDesc(t().sPrivacyDesc);
  }

  private renderEditor(containerEl: HTMLElement, existing: Profile | null, secure: boolean): void {
    const draft: Omit<Profile, 'id'> & { id: string } = existing ? { ...existing } : { id: newProfileId(), ...BLANK() };
    let apiKey = '';
    let urlSetting: Setting | null = null;
    new Setting(containerEl).setName(existing ? t().sEditProfile(existing.name) : t().sNewProfile).setHeading();
    new Setting(containerEl).setName(t().sName).addText(text => text.setPlaceholder(t().sNamePlaceholder).setValue(draft.name).onChange(value => { draft.name = value.trim(); }));
    new Setting(containerEl).setName(t().sService).setDesc(t().sServiceDesc).addDropdown(drop => drop.addOption('openai', 'OpenAI').addOption('ollama', 'Ollama Cloud').addOption('custom', t().sCustom).setValue(draft.provider).onChange(value => { draft.provider = value as Profile['provider']; urlSetting?.settingEl.toggle(draft.provider === 'custom'); }));
    urlSetting = new Setting(containerEl).setName(t().sBaseUrl).setDesc(t().sBaseUrlDesc).addText(text => text.setPlaceholder('https://…/v1').setValue(draft.baseURL ?? '').onChange(value => { draft.baseURL = value.trim() || undefined; }));
    urlSetting.settingEl.toggle(draft.provider === 'custom');
    new Setting(containerEl).setName(t().sModel).setDesc(t().sModelDesc).addText(text => text.setPlaceholder('model-id').setValue(draft.model).onChange(value => { draft.model = value.trim(); }));
    new Setting(containerEl).setName(t().sKey).setDesc(existing ? t().sKeyDescExisting : t().sKeyDescNew).addText(text => { text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.setPlaceholder(existing ? '••••••••' : 'sk-…').onChange(value => { apiKey = value.trim(); }); });
    new Setting(containerEl).setName(t().sKeyStorage).setDesc(secure ? t().sKeyStorageDesc : t().sKeyStorageNoSecure).addDropdown(drop => { drop.addOption('session', t().sSessionOnly); if (secure) drop.addOption('persistent', t().sOnDevice); drop.setValue(secure ? draft.storage : 'session').onChange(value => { draft.storage = value as Profile['storage']; }); });
    new Setting(containerEl).setName(t().sTokenField).addDropdown(drop => drop.addOption('max_completion_tokens', 'max_completion_tokens').addOption('max_tokens', 'max_tokens').setValue(draft.tokenLimitField).onChange(value => { draft.tokenLimitField = value as Profile['tokenLimitField']; }));
    new Setting(containerEl).setName(t().sResponseFormat).setDesc(t().sResponseFormatDesc).addDropdown(drop => drop.addOption('json_object', 'json_object').addOption('json_schema', 'json_schema').addOption('prompt', t().sPromptOnly).setValue(draft.responseFormat).onChange(value => { draft.responseFormat = value as Profile['responseFormat']; }));
    new Setting(containerEl).setName(t().sTimeout).setDesc(t().sTimeoutDesc(5, MAX_TIMEOUT_S, DEFAULT_TIMEOUT_S)).addText(text => text.setValue(String(draft.timeoutSeconds)).onChange(value => { draft.timeoutSeconds = Number(value); }));
    new Setting(containerEl).setName(t().sMaxTokens).setDesc(t().sMaxTokensDesc).addText(text => text.setValue(String(draft.maxOutputTokens)).onChange(value => { draft.maxOutputTokens = Number(value); }));
    new Setting(containerEl)
      .addButton(button => button.setButtonText(t().cancel).onClick(async () => { this.editing = null; await this.display(); }))
      .addButton(button => button.setButtonText(t().sSaveProfile).setCta().onClick(async () => {
        try {
          const { baseURL, ...rest } = draft;
          const saved = await this.plugin.profiles.save(draft.provider === 'custom' ? { ...rest, baseURL } : rest, apiKey || undefined);
          new Notice(t().sProfileSaved(profileLabel(saved)));
          if (saved.provider === 'custom' && /^http:/i.test(saved.baseURL ?? '')) new Notice(t().noticeCleartextKey, 10000);
          this.editing = null;
          await this.display();
        } catch (error) { new Notice(describeError(error)); }
      }));
  }
}
