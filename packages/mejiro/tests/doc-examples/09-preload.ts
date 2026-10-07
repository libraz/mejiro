import { MejiroBrowser } from '@libraz/mejiro/browser';

export async function preload(text: string) {
  // #region doc:preload
  const mejiro = new MejiroBrowser({
    fixedFontFamily: '"Noto Serif JP"',
    fixedFontSize: 16,
  });

  // Preload during app initialization
  await mejiro.preloadFont();

  // Subsequent layout calls skip the font loading step
  const result = await mejiro.layout({ text, lineWidth: 400 });
  // #endregion doc:preload
  return result;
}
