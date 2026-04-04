# Securly Web Links Generator

Chrome extension prototype for recording a classroom service flow and generating a Securly Web Link suggestion with AI.

## Load The Extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `/Users/chasedouglas/devel/securly-weblinks-generator`.

## Current Flow

1. Open the extension popup.
2. Open `Settings` and save a Gemini API key if one is not already configured.
3. Click `Start a New Recording`.
4. Navigate through the school dashboard, sign-in flow, target app, and any in-app pages that must work.
5. Click `Stop Recording and Generate Web Links`.
6. Copy the proposed `Site` and `Dependencies` into Securly.

## Notes

- Request capture is active only during an explicit recording session.
- Captured request data is stored only in session storage and cleared on reset or after successful analysis.
- The popup provides live AI processing feedback, copyable `Site` and `Dependencies` outputs, and a rationale list for the chosen scope.
