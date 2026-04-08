# Install The Extension

These instructions explain how to install Securly Web Links Generator on a laptop using Chrome's `Load unpacked` option.

## Before You Start

You should have:

- access to the GitHub project releases page
- an API key to paste into the extension after installation

## Step 1: Download The Latest Release

1. Open the project releases page:
   [https://github.com/txase/securly-weblinks-generator/releases](https://github.com/txase/securly-weblinks-generator/releases)
2. Open the most recent release.
3. Under `Assets`, download the `.zip` file for the extension.

At the time of writing, the release archive name looks like:

- `securly-weblinks-generator-v0.0.1.zip`

If you received a `.zip` file, unzip it first. Do not try to load the `.zip` directly into Chrome.

## Step 2: Unzip The Download

1. Find the downloaded `.zip` file on your computer.
2. Unzip it so you have a normal folder on your computer.

Do not try to load the `.zip` file directly into Chrome.

## Step 3: Install In Chrome

1. Open Google Chrome.
2. In the address bar, go to `chrome://extensions`.
3. Turn on `Developer mode` in the top-right corner.
4. Click `Load unpacked`.
5. Select the unzipped extension folder.

You should now see `Securly Web Links Generator` in the Chrome extensions list.

## Step 4: Pin The Extension

1. Click the Chrome extensions icon (the puzzle piece).
2. Find `Securly Web Links Generator`.
3. Click the pin icon so it stays visible in the toolbar.

## Step 5: Add The API Key

1. Click the `Securly Web Links Generator` icon in the toolbar.
2. Open the `Settings` section if it is collapsed.
3. Paste the API key you were given into the `Gemini API key` field.
4. Click `Save API Key`.

## Step 6: Use The Extension

1. Click `Start a New Recording`.
2. Walk through the lesson flow exactly as students would use it.
   Example: district dashboard -> sign-in -> learning app -> lesson page or resource.
3. Click `Stop Recording and Generate Web Links`.
4. Wait for the extension to finish processing.
5. Review the generated:
   - `Site`
   - `Content Dependencies`
   - `Multimedia Dependencies`
   - `Social Media Dependencies`
6. Copy the results into Securly.

## Updating To A New Version

When a new version is available:

1. Go back to the releases page:
   [https://github.com/txase/securly-weblinks-generator/releases](https://github.com/txase/securly-weblinks-generator/releases)
2. Download the latest `.zip` file.
3. Unzip it and replace the old extension folder with the new one.
4. Open `chrome://extensions`.
5. Find `Securly Web Links Generator`.
6. Click `Reload`.

## Troubleshooting

### The extension will not install

Make sure:

- you unzipped the file first
- you selected the folder containing `manifest.json`

### The Start button is disabled

Make sure:

- the API key was pasted into `Settings`
- `Save API Key` was clicked

### The extension shows an error

Try:

1. Canceling and starting a new recording
2. Reloading the extension from `chrome://extensions`
3. Closing and reopening the popup

### Chrome says Developer mode is required

That is expected for this installation method. `Load unpacked` is intended for testing and pilot distribution before normal Chrome Web Store installation.
