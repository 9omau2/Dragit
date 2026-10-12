globalThis.AI_TRANSLATOR_DEFAULTS = Object.freeze({
  model: "gemini-3.5-flash-lite",
  maxChars: 6000,
  selectionEnabled: true
});

// Use installed fonts only; settings never load remote font files.
globalThis.DRAGIT_RESULT_FONTS = Object.freeze({
  families: Object.freeze({
    system: '',
    sans: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
    serif: 'Batang, "AppleMyungjo", Georgia, serif',
    mono: 'Consolas, "SFMono-Regular", Menlo, monospace'
  }),
  defaultSize: 14,
  sizes: Object.freeze(Array.from({ length: 13 }, (_, index) => index + 12)),
  normalize(settings) {
    return {
      family: Object.hasOwn(this.families, settings.resultFontFamily) ? settings.resultFontFamily : 'system',
      size: this.sizes.includes(settings.resultFontSize) ? settings.resultFontSize : this.defaultSize
    };
  },
  apply(element, settings) {
    const { family, size } = this.normalize(settings);
    element.style.fontFamily = this.families[family];
    element.style.fontSize = `${size}px`;
  }
});
