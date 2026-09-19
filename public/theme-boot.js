/*
 * XOT theme boot (Linear 0X3-607).
 * Runs before first paint as a plain blocking script so the resolved theme
 * class is already on <html> when the first frame renders — no opposite-theme
 * flash. Mirrors ThemeContext.tsx:
 *   - first use defaults to dark,
 *   - `light`/`dark` are explicit preferences,
 *   - `system` follows the OS only while selected,
 *   - any failure (blocked storage, missing matchMedia) resolves to dark.
 */
(function () {
  var dark = true;
  try {
    var stored = window.localStorage.getItem('xot-theme-preference');
    if (stored === 'light') {
      dark = false;
    } else if (stored === 'system') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch (error) {
    dark = true;
  }
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
