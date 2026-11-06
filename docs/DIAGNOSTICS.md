# Diagnostics and recoverable errors

Browser warnings use `[Kalaayana]` with an allowlisted event code and UTC timestamp. Output is limited to 20 events per page load. No enquiry values, raw exceptions, stacks, image URLs or query strings are recorded by this logger. Native browser diagnostics are not suppressed.

Use browser Developer Tools > Console to inspect warnings. There is no remote collector, tracking cookie or persistent log storage. Reproduce the issue and note the event code and application version when reporting it.

Contact draft failures retain the enquiry on screen and direct visitors to the email link. A successful mailto handoff does not mean an enquiry was sent. Policy fetches have a 15-second timeout and a full-page fallback. Closing a policy aborts its fetch. Preview failures restore scrolling and open the source image; failed images show a retry/next-image message. Invalid image dimensions fall back safely.

Build failures while writing legacy redirects exit nonzero with an actionable error. Existing Astro build errors and deployment guards continue to fail the job.

Validation: `node --test scripts/diagnostics.test.mjs`, `npm run build`, `python scripts/check.py`.
