# Website release versions

`VERSION` is the source of truth. The current staging candidate is `1.2.17`; the last published tag is `v1.2.16`.
Its GitHub Release records publication, merged commit and deployment status.
The website footer reads this file during build; it must not have a separate
hard-coded version. Deployment stamping adds the commit, environment and build
time in `version.json`, and release tags use `v` followed by the same version.

Use the custom format `MAJOR.MINOR.PATCH`, with a two-digit patch from `00` to
`99`. For example: `1.20.98` → `1.20.99` → `1.21.00` → `1.21.01`.
This is a custom release format, not strict Semantic Versioning: SemVer does
not allow a leading zero in a numeric component. Do not use npm version to bump
this format. Historic tags with a single-digit patch remain valid history.

- Preview the next number: `npm run version:next -- --dry-run`.
- Update VERSION for a planned release: `npm run version:next`.
- Add a matching CHANGELOG.md entry, build and check before tagging or releasing.
- Use the exact version in release names and tags; keep production frozen as
  required by the existing release workflow and FREEZE file.

The bump command changes only VERSION; it does not commit, tag, push, publish
or deploy. Rebuild after changing it so the footer matches the release.

## One sequence, two release statuses

Stable releases and staging prereleases share one increasing sequence. Do not
derive the next number from the latest stable release alone. Published tags
consume numbers even when not deployed to production. Never delete or move a
historical tag to fill a gap. Current candidate 1.2.17 is reserved; the next bump command prepares 1.2.18.

After 1.2.99 comes 1.3.00. The example 1.20.99 -> 1.21.00 describes rollover,
not the current version. Historical single-digit patches remain unchanged.

## Historical ledger

Reviewed on 2 November 2026 against GitHub releases, branch refs and local history.

| Version | Evidence | Status |
| --- | --- | --- |
| 1.2.8 | GitHub stable release | Production main remains at 611c134; see current GitHub Release statuses. |
| 1.2.9 | Dated changelog entry and annotated historical tag | Tag added retrospectively on 2 November 2026 at merged staging commit c8096af (PR #58). Historical staging GitHub prerelease created on 2 November; no production deployment. |
| 1.2.10 | Changelog entry and Git tag | Historical staging GitHub prerelease created on 2 November. |
| 1.2.11 | GitHub prerelease, develop at b26dacc | Published staging image enhancement. Notes report Cloudflare failure; deployment was not verified. |
| 1.2.12 | Published GitHub Release at b61cfa1 | GitHub currently marks this Latest; production main is still 611c134. |
| 1.2.13 | Merged PR #62 at 11ea4a2 | Staging prerelease published 4 November 2026; CI and Cloudflare build checks succeeded. |
| 1.2.14 | Tag at d9d32b8, PRs #63/#64 | Staging prerelease published 4 November 2026. CI passed; latest Cloudflare build failed; live verification pending. |
| 1.2.15 | Tag at 9c28e17, PR #65 | Staging prerelease published 5 November 2026. |
| 1.2.16 | Merged PR #66 at 6f6c3ec | Published staging prerelease, 5 November 2026. |
| 1.2.17 | VERSION and Unreleased changelog | Security, clean URLs, SEO and diagnostics staging candidate. |

The earlier explanation that 1.2.9 had no release record was incomplete: its
changelog entry already existed. Its missing tag was subsequently restored at
the original merged staging commit, without backdating the tag creation.
A changelog entry, tag, GitHub Release and deployment
are separate records and must not be treated as interchangeable.

Sources: [releases](https://github.com/SHRENIKYD/KAlAAYANA/releases),
[v1.2.12](https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.2.12),
[v1.2.11](https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.2.11),
[v1.2.8](https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.2.8).

## Staging release procedure

1. Check remote tags, releases and open PRs before reserving a number.
2. Prepare matching VERSION and CHANGELOG entries. Use Unreleased until publication.
3. Build and check, commit through a PR into develop, and require passing CI.
4. Verify actual staging deployment and version.json against the reviewed commit.
5. When a release is requested, tag that exact commit and publish a prerelease,
   not a stable/latest release. Date its notes and record real deployment status.
6. Production requires explicit approval and RELEASE_READINESS.md checks.

The production workflow skips release creation for an existing tag; it does
not promote an existing prerelease. Use an unused next version for a production
merge unless explicit promotion has been implemented and verified. Never reuse
a staging tag for a different commit. A prerelease does not authorise deployment.
