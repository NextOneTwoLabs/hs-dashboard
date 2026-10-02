// The page title gets focus after navigation (#11), so a screen reader reads the new page. That focus is scripted,
// and browsers draw a :focus-visible ring on it when the last input was a key (e.g. Enter in the search; owner,
// #31). The title is tabindex="-1": not in the tab order and nothing to act on, so its ring is noise (WCAG 2.4.7
// is about what you can operate). data-scripted-focus marks the scripted focus for the CSS rule
// `.content-title[data-scripted-focus]:focus-visible { outline: none; }`, in every engine (FocusOptions'
// focusVisible is not honoured everywhere, Kongming #31 v3), and goes when the title loses focus.
export function focusPageTitle(doc = document) {
  const h = doc.querySelector('.content-title');
  if (!h) return null;
  h.setAttribute('data-scripted-focus', '');
  h.addEventListener('blur', () => h.removeAttribute('data-scripted-focus'), { once: true });
  h.focus({ preventScroll: true });
  return h;
}
