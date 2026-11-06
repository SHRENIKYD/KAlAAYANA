/** Fixed event codes only; no user data or raw exceptions. */
export function report(code: string): void {
  (
    window as Window & { KalaayanaDiagnostics?: { report: (code: string) => void } }
  ).KalaayanaDiagnostics?.report(code);
}
