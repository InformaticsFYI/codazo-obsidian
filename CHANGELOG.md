# Changelog

## Unreleased

Codazo now runs on iPad and iPhone, and should run on Android, which has not been tested yet. Minimum Obsidian stays 1.11.5. Desktop behavior is unchanged.

- On mobile, requests use the Obsidian app's own connection with redirects refused, so the key and text still reach only the confirmed destination. Obsidian's `requestUrl` is not used because it follows redirects.
- A server that refuses requests from the Obsidian app, or cannot be reached, now reports the failure as `(network)`. On mobile the message explains the likely cause.
- The pane has buttons for review, study guide, excerpt, and whole-note review, so a touch screen without the editor menu still has a way in.
- Tapping an inline translation in Reading view shows it; tapping again hides it.
- On a phone, choosing an observation closes the sidebar so the phrase is visible.
- The redirect probe can listen on the local network (`--lan`) for testing from a device, and answers cross-origin preflight checks so the redirect itself is exercised.

## 0.2.2

Validator-clean patch. Minimum Obsidian stays 1.11.5; desktop only. No change to behavior, profiles, keys, saved notes, or settings.

- Shared modules follow Obsidian's plugin guidelines fully: window-scoped timers, no `globalThis`, no bare `fetch` (the host must supply the transport), and the browser-only download helper is gone. The community validator now reports no warnings.
- CI uploads its build artifact with `actions/upload-artifact` v7.

## 0.2.1

Compatibility-preserving patch. Minimum Obsidian stays 1.11.5; desktop only. Existing profiles, keys, saved notes, and settings are unchanged.

- Settings appear in Obsidian's settings search on 1.13 and later through the declarative settings API; older versions keep the same settings rendered as before.
- Delete buttons use Obsidian's destructive style without the deprecated API.
- Cleaner settings lifecycle: no unhandled promises, consistent re-rendering after changes.
- Error and diagnostic handling tightened per the validator: typed narrowing at validation boundaries, no thrown non-Error values, no redundant assertions.
- Reduced-motion styling targets only the animated elements instead of a blanket `!important` rule.
- Popout-window-safe DOM creation through Obsidian's helpers.
- Documentation: accounts and network use are described precisely (no Codazo account; your own provider account and key; what is sent, where, and when).
- Manifest `authorUrl` now points at the plugin site, https://plugin.codazo.io/.
- Release assets are the three files Obsidian installs; checksums are in the release notes and `RELEASE.json`; license texts remain inside `main.js`.
- Releases are attested from the public repository so `gh attestation verify` proves provenance of the exact bytes.

## 0.2.0

First public release in Obsidian's community plugin directory.
