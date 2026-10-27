// Copy text to the clipboard (web). `navigator.clipboard` only exists on secure pages (https / localhost); the portal can also be served
// over plain http, so fall back to a hidden textarea + execCommand('copy'). Resolves true when the text was copied, false otherwise
// (native, or a browser that refuses): callers then leave the text selectable.
function fallbackCopy(text) {
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}

export function copyText(text) {
  const value = String(text == null ? '' : text);
  return new Promise((resolve) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window !== 'undefined' && window.isSecureContext) {
        navigator.clipboard.writeText(value).then(() => resolve(true), () => resolve(fallbackCopy(value)));
        return;
      }
    } catch (e) { /* fall through to the textarea copy */ }
    resolve(fallbackCopy(value));
  });
}
