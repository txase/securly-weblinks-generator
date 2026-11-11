# Securly Web Links Generator

Securly Web Links Generator is a Chrome extension that helps educators build Securly allow lists from a real browser session instead of manually guessing every domain involved in a lesson flow.

Teachers can record a path through a district portal, sign-in sequence, LMS, lesson resource, or embedded tool, then let AI suggest:

- the primary `Site` value for Securly
- one `Dependencies` list for supporting domains
- rationale explaining why each site is included and how broadly it should be scoped

For local installation instructions, see [INSTALL.md](INSTALL.md).

## What It Does

The extension records browser requests during a session you start. In Settings, choose all network requests or top-level page loads only. The extension sends AI an ordered list of recorded URLs with query strings and fragments removed. It uses top-level requests to generate the choices for Site and Dependencies in both modes.

- `Site`
- `Dependencies`

The results also include collapsed analysis rationale with matched request counts and the types of requests recorded for each rule.

## Why This Exists

Securly Web Links often require more than a single domain. A typical educational flow may involve:

- district dashboards and launch pages
- SSO or identity provider redirects
- first-party product subdomains
- CDN, asset, API, and document hosts
- media or social embeds used inside the lesson

This project is intended to reduce the trial-and-error involved in discovering those dependencies manually.

## Current Workflow

1. Open the extension popup.
2. Open `Settings` and save a Gemini API key if one is not already configured.
3. Click `Start a New Recording`.
4. Navigate through the exact lesson flow students need to access.
5. Click `Stop Recording and Generate Web Links`.
6. Review the generated `Site` and `Dependencies` list.
7. Copy the results into Securly.

## Project Structure

- [manifest.json](/Users/chasedouglas/devel/securly-weblinks-generator/manifest.json): Chrome extension manifest and permissions
- [src/background.js](/Users/chasedouglas/devel/securly-weblinks-generator/src/background.js): recording, normalization, and AI integration
- [src/popup.html](/Users/chasedouglas/devel/securly-weblinks-generator/src/popup.html): popup UI markup
- [src/popup.js](/Users/chasedouglas/devel/securly-weblinks-generator/src/popup.js): popup rendering and user actions
- [src/popup.css](/Users/chasedouglas/devel/securly-weblinks-generator/src/popup.css): popup styling
- [INSTALL.md](INSTALL.md): educator-friendly install instructions for the unpacked extension

## Notes

- Recording is active only during an explicit user-started session.
- Recorded session data is kept only in session storage and is cleared after completion or reset.
- The extension currently relies on a user-provided Gemini API key stored locally in Chrome extension storage.
- The current release package is published through GitHub releases for pilot testing and through the Chrome Web Store flow for broader educator testing.

## Third-Party Data

The bundled [Public Suffix List](https://publicsuffix.org/list/) is distributed
under the [Mozilla Public License 2.0](licenses/MPL-2.0.txt). Its upstream
version and revision are recorded in [the data file](src/public_suffix_list.dat).
