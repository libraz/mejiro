// Test environment shim. happy-dom does not implement Canvas 2D context or
// `document.fonts`, both of which mejiro's browser layer touches. For
// component tests we don't care about glyph widths or font readiness — stub
// both so layout proceeds without crashing.

if (typeof HTMLCanvasElement !== 'undefined') {
  const stubContext = {
    font: '',
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as unknown as CanvasRenderingContext2D;

  // biome-ignore lint/suspicious/noExplicitAny: stubbing read-only DOM API
  (HTMLCanvasElement.prototype as any).getContext = function getContext() {
    return stubContext;
  };
}

if (typeof document !== 'undefined' && !document.fonts) {
  // biome-ignore lint/suspicious/noExplicitAny: stubbing read-only DOM API
  (document as any).fonts = {
    check: () => true,
    load: () => Promise.resolve([]),
    ready: Promise.resolve(),
  };
}
