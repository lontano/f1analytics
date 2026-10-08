export function googlePopupAuthIsBroken(): boolean {
  const ua = navigator.userAgent;
  if (/CursorBrowser|\bCursor\//i.test(ua)) return true;
  if (/jsdom|HappyDOM/i.test(ua)) return false;
  const native = (fn: unknown) => Function.prototype.toString.call(fn).includes("[native code]");
  return !native(window.alert) || !native(window.open);
}
