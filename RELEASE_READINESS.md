# Launch readiness

Updated 5 November 2026. Candidate **1.2.16** is local and unreleased.
This checklist is a release record, not launch approval.

## Verified repository state

- Production main: 611c1347909f9833ff84e39624c6b3de1e82e016.
- Staging develop: 9c28e17310c4db5e0ee10d900e63fba825523a14 (merged PR #65).
- GitHub Latest release: v1.2.12. Latest staging prerelease: v1.2.15 (published 4 November 2026).
- Active ruleset requires PRs and Checks on both branches, prohibits force pushes
  and deletion, but currently requires zero approving reviews.
- develop/FREEZE contains 2026-11-07. Keep it unchanged during feature work.

## Production blockers

- [ ] Close the freeze enforcement gap: main's production workflow and check.py
  lack develop's guards. Manual runs from main are not fully blocked. Require
  approval on the github-pages environment or equivalent release protection,
  and verify settings directly before claiming protection.
- [ ] Confirm freeze timing. Current workflow code compares UTC dates and permits
  release from 05:30 IST on 7 November, not after the end of that day. Reaching
  that time is not release approval. Do not shorten the existing freeze.
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
- [ ] Match VERSION, footer, changelog, tag and release title to 1.2.16.
- [ ] Run npm ci, npm run build and python scripts/check.py; require passing CI.
- [ ] Compare staging version.json with the reviewed version and commit.
- [ ] Check desktop/mobile menu, Works, six Works categories, image framing, links,
  contact mail draft, map, policy pages and favicon in a browser.
- [ ] When requested, publish staging v1.2.16 as a prerelease with an actual date,
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
