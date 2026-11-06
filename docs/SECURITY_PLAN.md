# Kalaayana security plan

Assessment: 6 November 2026. Planning and read-only inspection only; no controls
or deployments changed. Existing SEO working changes remain separate.

## Scope and threat model
Astro generates static files. Production is GitHub Pages; wrangler.jsonc describes
an assets-only Cloudflare Worker for staging. Enquiries use encoded mailto links,
not a submission API. No login, payment processing or customer database was found
in this reviewed flow. Primary risks: account takeover, malicious repository or
build changes, dependency compromise, injected browser content, domain takeover,
and availability. Static hosting reduces server attack surface but is not immunity.

## Verified findings
- main and develop require PRs and Checks, disallow deletion/force pushes, and
  have no bypass actors; required approving review count is zero.
- github-pages environment has a branch policy, no required-reviewer rule returned.
- Production workflow grants contents/pages/id-token write at workflow scope.
  Actions are referenced by version tags rather than immutable commit hashes.
- Rollback tag input is interpolated directly into shell run text. Validate input
  and pass via environment variables instead; treat this as a workflow injection
  risk to fix, not proof of exploitation. Manual production workflow also needs
  an explicit main-ref restriction.
- Freeze comparison permits deployment from 7 November UTC; reaching a date is
  not release approval. Missing/unreadable freeze data can permit execution.
- Live HTTPS homepage response lacked CSP, HSTS, X-Content-Type-Options,
  Referrer-Policy and Permissions-Policy in this request. Recheck at actual edge.
- npm audit reports 8 findings: 6 high, 2 moderate. Affected dependency names:
  astro, devalue, sharp, smol-toml, source-map-js, undici, vite and zod. These are
  in the build tooling tree; assess each advisory and reachable execution path.
  This does not establish eight exploitable production vulnerabilities.
- Trusted repository story copy uses set:html; preserve a strict trust boundary
  and never feed visitor/CMS content into it without sanitisation.
- External Google Fonts and Maps are used. CSP must account for these and inline
  scripts/styles without breaking menus, image previews, maps or typography.

## P0: before production launch
1. Protect GitHub, registrar, DNS and Cloudflare accounts with passkeys/security
   keys or MFA. Review collaborators, recovery codes, OAuth apps and API tokens.
   Owner/account settings still require verification; never copy secrets to notes.
2. Require an independent approving reviewer for main and the production
   environment, restrict deploy branches, require resolved threads and approval
   of the latest push, and cover workflow files with CODEOWNERS. Keep staging
   review practical. Require MFA for organisation members where available.
3. Harden production and rollback: main-only manual runs, fail closed when freeze
   state cannot be verified, validated tag input passed through environment vars,
   least-privilege job permissions, full-SHA action pins, and reviewed artifacts.
   Retain the existing freeze until explicit approval; no automatic launch.
4. Triage all npm advisories, upgrade in an isolated PR, review lockfile changes,
   rebuild and test. Do not apply npm audit fix --force blindly. CI uses npm ci;
   add Dependabot for npm and Actions and secret scanning where supported.
5. Select a production edge that actually supports response headers. A Cloudflare
   _headers file alone will not configure GitHub Pages responses. Confirm DNS
   proxying/routing before claiming enforcement. Roll out CSP report-only first,
   then enforce hashes for inline scripts (or externalise them). Baseline:
   object-src none, base-uri self, frame-ancestors none, narrow script/style/img/
   font/frame/connect allowlists. Add nosniff, strict-origin-when-cross-origin,
   appropriate Permissions-Policy, and HSTS only after HTTPS/subdomain review.
   Do not preload or includeSubDomains until every affected host is verified.
6. Confirm staging Access restrictions and noindex; robots/noindex is not access
   control. Confirm public artifacts contain no .env, keys, source-only private
   files or sensitive source maps. Review DNS/TLS and prevent dangling records.

## P1: first week after launch
- Enable uptime/TLS/DNS alerts and deployment notifications. Review GitHub audit
  and Cloudflare security events. Define an owner for each alert and response.
- Use platform DDoS protection and targeted rate limits/bot controls appropriate
  to a static site; avoid blanket challenges that block users or search crawlers.
- Document a private vulnerability reporting route and SECURITY.md. Confirm the
  monitored contact before publishing response-time commitments.
- Review unnecessary third-party requests; consider self-hosting licensed fonts.
- Store recovery instructions and an offline account recovery kit; rehearse a
  revert/deploy of a known-good artifact within the protected approval workflow.

## If forms/payments/accounts are added later
Reassess before implementation: server-side validation, abuse protection, request
limits, CSRF/session security where relevant, safe storage, access controls,
retention and logging without sensitive data. Keep payment data with a suitable
payment provider. Browser validation alone is not a security boundary.

## Acceptance gates
- PR and production approval controls verified with a non-admin path.
- CI build, catalogue checks, dependency review, secret scan and workflow checks
  pass, or each exception has a documented owner and expiry.
- Automated tests reject invalid rollback input and unapproved deployment refs;
  manual injection probes are not executed against production.
- Actual production HTTP responses contain the intended headers, including error
  pages, and enforced CSP produces no unexplained violations in tested flows.
- Test desktop/mobile menu, gallery, swipe, policy dialog, mailto and map.
- Confirm no staging indexing, verify exact deployed version/commit, and rehearse
  rollback. Perform only authorised passive checks on third-party hosting.

## Order and release method
P0 account/hosting decisions first; then separate small PRs for workflow guards,
dependencies, and headers/CSP. Validate on staging and use the next unused version
at release time (do not move v1.2.16). Production requires explicit approval even
after 7 November. Cloudflare failure may be non-blocking for a staging merge per
the user's existing preference; it is not evidence that security controls deployed.

## References
- https://docs.github.com/en/actions/reference/security/secure-use
- https://developers.cloudflare.com/pages/configuration/headers/
- https://developers.cloudflare.com/client-side-security/how-it-works/

## Implementation update ? 6 November 2026
User confirms GitHub and Cloudflare MFA is already enabled.
Local code now pins Actions, scopes deployment/release permissions per job, validates
rollback tags without shell interpolation, and fails closed on production refs,
fetch errors or any remaining FREEZE file. Four guard tests cover main, invalid
refs, expired/invalid freeze markers and hostile tag strings. Dependabot targets
develop for npm/Actions. CI audits high/critical npm advisories.
Dependencies were refreshed within existing ranges and sharp explicitly upgraded
to 0.35.5; npm audit reports zero findings at preparation time.
public/_headers supplies baseline headers and report-only CSP for Cloudflare static
assets. It is not enforced CSP, has no remote reporting collector, and does not
configure GitHub Pages. HSTS, account/branch approvals, production edge routing,
secret scanning settings and live header verification remain operational tasks.
No release or production settings were changed by this implementation.

Validation: Astro build passed (58 routes); catalogue checks passed (59 HTML files, 46 projects, 151 photographs); four deployment guard tests and three version tests passed. npm audit reports zero findings. Clean npm ci hit a Windows compiler-file lock; npm install restored the dependencies successfully. CI must confirm clean installation on Linux.
