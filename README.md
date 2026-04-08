# Securly Web Links Generator

Securly Web Links Generator is a Chrome extension that helps educators build Securly allow lists from a real browser session instead of manually guessing every domain involved in a lesson flow.

Teachers can record a path through a district portal, sign-in sequence, LMS, lesson resource, or embedded tool, then let AI suggest:

- the primary `Site` value for Securly
- categorized dependency groups for supporting domains
- rationale explaining why each site is included and how broadly it should be scoped

For local installation instructions, see [INSTALL.md](/Users/chasedouglas/devel/securly-weblinks-generator/INSTALL.md).

## What It Does

The extension records browser request activity during an explicit teacher-started session, normalizes those requests into a domain summary, and sends that summary to AI for analysis. The output is organized to support real classroom allow-list workflows:

- `Site`
- `Content Dependencies`
- `Multimedia Dependencies`
- `Social Media Dependencies`

The results also include collapsed analysis rationale with matched request counts and notes about the kinds of content loaded from each domain.

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
6. Review the generated `Site` and categorized dependency groups.
7. Copy the results into Securly.

## Project Structure

- [manifest.json](/Users/chasedouglas/devel/securly-weblinks-generator/manifest.json): Chrome extension manifest and permissions
- [src/background.js](/Users/chasedouglas/devel/securly-weblinks-generator/src/background.js): recording, normalization, and AI integration
- [src/popup.html](/Users/chasedouglas/devel/securly-weblinks-generator/src/popup.html): popup UI markup
- [src/popup.js](/Users/chasedouglas/devel/securly-weblinks-generator/src/popup.js): popup rendering and user actions
- [src/popup.css](/Users/chasedouglas/devel/securly-weblinks-generator/src/popup.css): popup styling
- [INSTALL.md](/Users/chasedouglas/devel/securly-weblinks-generator/INSTALL.md): educator-friendly install instructions for the unpacked extension

## Notes

- Recording is active only during an explicit user-started session.
- Recorded session data is kept only in session storage and is cleared after completion or reset.
- The extension currently relies on a user-provided Gemini API key stored locally in Chrome extension storage.
- The current release package is published through GitHub releases for pilot testing and through the Chrome Web Store flow for broader educator testing.
