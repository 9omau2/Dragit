# Dragit

Select text. Click the icon. Read the translation below the paragraph.

A Chrome extension powered by Gemini.

## Features

- Translate selected text without replacing the original
- Inline results that push page content down
- Custom context for terminology and tone
- Target language selector and on/off toggle
- Chameleon mode: match translation colors to the webpage
- Text polish: preserve tables, quotes, code blocks, lists, headings and inline formatting
- Optional PDF viewer with a translation panel
- Result font and size controls in Setting

## Install

1. Download and extract the ZIP from [Releases](https://github.com/9omau2/Dragit/releases/latest).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.
4. Open Dragit and add your [Gemini API key](https://aistudio.google.com/app/apikey) in Setting → API 설정.
5. Refresh the page, select text, and click the translation icon.

## PDF

Enable **Add-on → PDF viewer** in translation settings. Open or reload a `.pdf` URL, or choose a file with **Open PDF**. Select text and click the icon for a side-panel translation.

- Page thumbnails and click-to-jump navigation
- Resizable Result panel: right or bottom
- Show or hide the panel with **Result**
- 100% default zoom; type a percentage or use − / +

Local PDF auto-open requires **Allow access to file URLs** in Chrome extension details. Scanned PDFs need a text layer; OCR is not included.

## Models

Gemini API only. Bring your own API key.

- `gemini-3.5-flash-lite` (default)
- `gemini-3.1-flash-lite`
- `gemini-2.5-flash-lite`

Other Gemini model IDs can be entered in Setting → API 설정.
