/* Local diagnostics only: never record form values, URLs, messages or stacks. */
(() => {
  let count = 0;
  const allowed = new Set([
    'runtime_error',
    'unhandled_rejection',
    'image_load_failed',
    'preview_failed',
    'policy_load_failed',
    'policy_timeout',
    'policy_open_failed',
    'contact_failed',
  ]);
  window.KalaayanaDiagnostics = Object.freeze({
    report(code) {
      if (!allowed.has(code) || count >= 20) return;
      count += 1;
      console.warn('[Kalaayana]', { event: code, time: new Date().toISOString() });
    },
  });
  window.addEventListener(
    'error',
    (event) => {
      window.KalaayanaDiagnostics.report(
        event.target instanceof HTMLImageElement ? 'image_load_failed' : 'runtime_error',
      );
    },
    true,
  );
  window.addEventListener('unhandledrejection', () => {
    window.KalaayanaDiagnostics.report('unhandled_rejection');
  });
})();
