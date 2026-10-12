/* Local color sampling only; no page content or screenshots leave the browser. */
globalThis.DRAGIT_CHAMELEON = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  function parse(color) {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const rgba = [...context.getImageData(0, 0, 1, 1).data];
    rgba[3] /= 255;
    return rgba;
  }
  const blend = (foreground, background, alpha = foreground[3]) => background.slice(0, 3).map((c, i) => foreground[i] * alpha + c * (1 - alpha));
  const css = color => `rgb(${color.slice(0, 3).map(Math.round).join(', ')})`;
  function luminance(color) {
    const values = color.slice(0, 3).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function readable(color, background) {
    if (contrast(color, background) >= 4.5) return color;
    const target = contrast([0, 0, 0], background) > contrast([255, 255, 255], background) ? [0, 0, 0] : [255, 255, 255];
    for (let step = 1; step <= 20; step++) {
      const adjusted = blend(target, color, step / 20);
      if (contrast(adjusted, background) >= 4.6) return adjusted;
    }
    return target;
  }
  function palette(anchor) {
    const foreground = parse(getComputedStyle(anchor).color);
    const layers = [];
    let complex = false;
    for (let node = anchor; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parse(style.backgroundColor);
      layers.push(color);
      if (style.backgroundImage !== 'none' || Number(style.opacity) < 1 || style.mixBlendMode !== 'normal' || style.backdropFilter !== 'none') complex = true;
      if (color[3] >= .999) break;
    }
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    let background = scheme === 'dark' || (scheme.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches) ? [18, 18, 18] : [255, 255, 255];
    for (const layer of layers.reverse()) background = blend(layer, background);
    // Images, gradients and compositing cannot be represented by one sampled color.
    if (complex) background = luminance(foreground) > .45 ? [28, 27, 32] : [247, 246, 249];
    const text = readable(blend(foreground, background), background);
    const header = blend(text, background, .035);
    const accent = readable(luminance(background) < .25 ? [192, 164, 255] : [91, 33, 182], header);
    const codeBackground = blend(text, background, .075);
    const codeText = readable(luminance(background) < .25 ? [183, 216, 255] : [77, 52, 137], codeBackground);
    return {
      '--panel-bg': css(background), '--panel-text': css(text),
      '--panel-header': css(header), '--panel-heading': css(readable(text, header)),
      '--panel-border': css(blend(text, background, .2)), '--panel-edge': css(blend(text, background, .2)),
      '--panel-muted': css(readable(blend(text, background, .72), background)),
      '--panel-accent': css(accent), '--panel-hover': css(blend(text, background, .08)),
      '--panel-code-bg': css(codeBackground), '--panel-code-text': css(codeText),
    };
  }
  return { palette };
})();
