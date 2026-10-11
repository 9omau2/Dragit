# Third-party software

PDF rendering uses [Mozilla PDF.js](https://github.com/mozilla/pdf.js), version 6.4.299.

Bundled from the official `pdfjs-dist` npm package; package integrity verified before extraction. All rendering code runs from the extension package.

`web/text_layer_builder.js` comes from the matching PDF.js v6.4.299 source tag. Its imports and null-character helper are adapted for this standalone viewer; the original license header is preserved.

- PDF.js: [Apache 2.0](vendor/pdfjs/LICENSE)
- Additional font and decoder licenses: `vendor/pdfjs/standard_fonts/`, `vendor/pdfjs/cmaps/`, and `vendor/pdfjs/wasm/`
