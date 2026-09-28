# Mobile acceptance

Run this on a real iPad and a real iPhone before a release that ships mobile support. Record the date, device, iOS version, Obsidian version, and plugin commit for each run in the pull request. Use synthetic Spanish text and dummy or low-limit keys, never real learner writing.

Android can install the plugin, but it is not part of this checklist. The README says it has not been tested.

## Install the test build

1. On the pull request, open the latest **CI** run and download the artifact named `codazo-` followed by the commit. It contains `main.js`, `manifest.json`, and `styles.css`.
2. Put the three files in `<vault>/.obsidian/plugins/codazo/` on a desktop copy of a test vault.
3. Get the vault to the device. With Obsidian Sync, turn on **Installed community plugins** in the Sync settings on both sides. With iCloud, copy the vault folder into Obsidian's iCloud folder from a Mac.
4. On the device, open the vault, go to **Settings → Community plugins**, and enable **Codazo**.

## Checks

For each check, record pass or fail, and what you saw when it failed.

### Keys

1. Add an OpenAI profile and choose to store the key persistently.
2. Record whether Codazo offers persistent storage, or refuses it and keeps the key for the session only. Either is safe. We need to know which one iOS does.
3. If persistent storage was offered, force-quit Obsidian, reopen it, and confirm a review works without re-entering the key.

### Reviews

4. With OpenAI, review a selection. The pane shows feedback, and the phrases are marked in the note.
5. With OpenRouter, review a selection.
6. With Ollama Cloud, review a selection. Record whether it works or shows the network error with the mobile explanation.
7. Cancel a review while it is in progress. The pane returns to idle and no result appears later.

### Redirects

8. On a computer on the same network, run `node scripts/redirect-probe.mjs --lan`. It prints a URL such as `http://192.168.1.20:4311/v1`.
9. Add a custom profile with that URL, key `PROBE-DUMMY`, and any model. Allow local network access if iOS asks.
10. Review synthetic text. Codazo must show an error. Stop the probe with `Ctrl+C`. The summary must say `redirect NOT followed. Expected.` Record the summary line.

### Local servers

11. Point a custom profile at a local server, such as LM Studio at `http://<computer>:1234/v1`, first with cross-origin requests off and then on. Record both results. This tells us whether plain HTTP on the local network is allowed on iOS at all.

### Touch

12. In Reading view, tap an inline translation. The English appears beside the word. Tap again to hide it.
13. In Live Preview, tap an inline translation. The raw `{palabra|translation}` text appears for editing.
14. In the pane, tap a marked phrase in **Tu texto**. The observation shows below the legend.
15. Select text, open the Codazo pane from the ribbon, and tap **Revisar la selección** at the top of the pane. The tap may clear the highlight in the note; the confirmation dialog must still show exactly the text you selected. Cancel, edit the note inside that passage, tap the button again: a notice asks you to select text, and nothing is sent. Then tap it with nothing ever selected in a fresh note: the same notice.
16. Long-press a selection in the editor. Record whether the Codazo menu sections appear. They are not expected to; the pane buttons, the command palette, and the mobile toolbar are the supported routes.

### Layout

17. On iPhone, choose an observation. The sidebar closes and the phrase is selected in the note.
18. On iPad, choose an observation, in both portrait and landscape. Record whether the phrase is visible, or hidden behind the sidebar.
19. Open the **Índice** tab and load a saved review. It loads without contacting the AI service.
20. Save a review, create a revision note, and export HTML. The files appear in the vault.
