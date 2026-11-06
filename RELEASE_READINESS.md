# Launch readiness

Updated 6 November 2026. Candidate **1.2.17** is local and unreleased.
This checklist is a release record, not launch approval.

## Verified repository state

- Production main: 611c1347909f9833ff84e39624c6b3de1e82e016.
- Staging develop: 6f6c3ec988b60ab41dc1d1d90e04af29f1f01413 (PR #66).
- Latest published staging prerelease: v1.2.16; GitHub Latest: v1.2.12.
- FREEZE is 2026-11-08T22:00:00+05:30 (22:00 IST Sunday 8 November, 16:30 UTC),
  set from the studio's stated end time. Production remains unchanged.
- Candidate workflow guards fail closed until reviewed removal of FREEZE;
  main has not received those guards yet. Account MFA was confirmed by user.

## Production blockers

- [ ] Close the freeze enforcement gap: main's production workflow and check.py
  lack develop's guards. Manual runs from main are not fully blocked. Require
  approval on the github-pages environment or equivalent release protection,
  and verify settings directly before claiming protection.
- [ ] Before production, integrate and verify candidate fail-closed guards on main.
  The candidate blocks while FREEZE exists regardless of date. Main still uses
  its earlier date-based guard; reaching the date is not release approval.
- [x] Privacy contacts supplied: Rashmi Jadhav (Chairperson), with Vijaya Bai
  (Chairperson) as alternate; enquiries use contact@kalaayanastudios.com.
- [ ] Complete final policy review. Policy notices now display an effective date of 7 November 2026 at the
  studio?s request; final legal review remains a launch prerequisite.
- [ ] Verify image rights, client permissions and appropriate disclosure of
  materially AI-reconstructed portfolio images. A footer does not prove title.
- [x] CI and Cloudflare build checks succeeded for v1.2.13 at 11ea4a2.
- [ ] Independently verify live staging version.json; build success alone is not live verification.

## Candidate verification

- [ ] Review and commit accumulated local changes through a PR to develop.
- [x] Match local VERSION, rebuilt footer and candidate notes to 1.2.17.
- [ ] Create matching tag and release only at the approved merged commit.
- [x] Local build, staging stamp, catalogue check, eight tests and audit passed.
- [ ] Clean npm ci and GitHub CI: Windows compiler file lock blocked local npm ci;
  npm install restored dependencies and the subsequent build passed.
- [ ] Compare staging version.json with the reviewed version and commit.
- [ ] Check desktop/mobile menu, Works, six Works categories, image framing, links,
  contact mail draft, map, policy pages and favicon in a browser.
- [ ] When requested, publish staging v1.2.17 as a prerelease with an actual date,
  detailed notes and accurate deployment status, without marking it latest.

## Approved production rollout

- [ ] Obtain explicit release approval and resolve the freeze blockers above.
- [ ] Select an unused next version if the staging tag is already consumed;
  existing automation skips an existing tag instead of promoting it.
- [ ] Decide the public entry page: production currently keeps the holding page
  at /. Only staging stamping swaps preview.html to /. A main merge alone does
  not make the full portfolio the production homepage.
- [ ] Prepare a reviewed develop-to-main PR with version and dated notes.
- [ ] Verify canonical URLs, indexing, links and policy return routes after any
  deliberate homepage swap. Check final contact details and policies.
- [ ] Record the rollback stable tag/commit and verify its build; rollback must
  obey the same freeze and approval controls as deployment.
- [ ] After approved deployment, verify production version.json, homepage and
  navigation, and record the stable release URL and deployed commit.

No tag, release, deployment or GitHub settings change was performed during this
preparation. Recheck GitHub and hosting state at actual release time.
