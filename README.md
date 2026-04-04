# Securly Web Links Generator

Chrome extension prototype for recording a classroom service flow and generating a Securly Web Link suggestion with Gemini.

## Load The Extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `/Users/chasedouglas/devel/securly-weblinks-generator`.

## Current V1 Flow

1. Open the extension popup.
2. Save a Gemini API key.
3. Click `Start Recording`.
4. Navigate through the school dashboard, sign-in flow, target app, and any in-app pages that must work.
5. Click `Stop Recording`.
6. Click `Analyze With Gemini`.
7. Copy the proposed `Site` and `Dependencies` into Securly.

## Notes

- Request capture is active only during an explicit recording session.
- Captured request data is stored only in session storage and cleared on reset or after successful analysis.
- Gemini output is read-only in the popup for v1.
