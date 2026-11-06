# Content admin — setup

The content admin lives at `/admin/` on **staging only**. It edits sections,
projects and photographs, and every save becomes one commit and one pull
request into `develop`. Production never ships it: `scripts/stamp.sh` removes
`dist/admin` for any environment but `staging`, and the production and
rollback workflows fail if it is present.

Three layers keep it private:

1. **Cloudflare Access** in front of the whole staging Worker (already on).
2. The Worker **verifies the Access JWT** on every `/admin/api/*` request and
   only accepts the emails in `ADMIN_EMAILS`.
3. The GitHub token lives in a **Worker secret**, never in the repo or browser.

## One-time setup (Cloudflare dashboard)

### 1. Read the Access application values

Zero Trust → Access → Applications → the staging application → Overview.

- **Team domain**: `<team>.cloudflareaccess.com` (Zero Trust → Settings → Custom pages shows the team name).
- **Application Audience (AUD) tag**: the long hex string on the application's overview.

Set the application's **Session duration** to 1 hour: the Worker signs editors
out one hour after sign-in regardless, and the admin shows the time left.

Put both in `wrangler.jsonc` under `vars` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`).
Editors and their roles are in `admin/users.json` (see Roles below);
`ADMIN_EMAILS` is only a fallback while that file is missing. These are not
secrets; the Access policy itself must also allow those emails.

### 2. Create the GitHub token

GitHub → Settings → Developer settings → Fine-grained tokens → Generate:

- Repository access: **only this repository**.
- Permissions: **Contents: Read and write**, **Pull requests: Read and write**.
- Expiry: your choice; set a reminder to rotate it.

### 3. Store the token as a Worker secret

Workers & Pages → `kalaayana` → Settings → Variables and Secrets → Add →
type **Secret**, name `GITHUB_TOKEN`, paste the token. Deploy.

Or from a machine with Wrangler logged in: `npx wrangler secret put GITHUB_TOKEN`.

### 4. Let the Worker write the log, and let accepted changes merge

GitHub → repository Settings → Rules → Rulesets → the `develop` ruleset →
**Bypass list** → add **Repository admin**. The token from step 2 acts as
the repository owner, so log entries (sign-ins, decisions, errors,
invitations) commit straight onto `develop`; every other push still has to
come through a pull request with passing checks. Without the bypass each log
entry opens its own pull request, and two open at once conflict.

GitHub → repository Settings → General → Pull Requests → tick
**Allow auto-merge**. When an editor accepts a preview while CI is still
running, the content pull request then merges on its own as soon as CI
passes. Without it, acceptance while CI is running asks you to merge on
GitHub.

### 5. Let the Worker keep the Access policy in step with the Users tab

Who may sign in at all is the Access application's Allow policy, and the
Worker rewrites that policy's Include list to the editors' emails on every
invitation, role change or removal. It needs a Cloudflare API token:

Cloudflare dashboard → My Profile → API Tokens → Create Token → Create
Custom Token: Permissions **Account · Access: Apps and Policies · Edit**,
Account Resources **Include · this account**, no client IP filter. Store it
as a Worker secret named `CF_API_TOKEN` (same place as `GITHUB_TOKEN`).
`CF_ACCOUNT_ID` is a plain variable in `wrangler.jsonc`.

Without the token the Users tab still works, but each invitation must also
be added to the Access policy by hand; the log line says so.

### 6. Website insights (optional)

The Insights tab shows visits, page views, pages, referrers, countries and
devices from Cloudflare Web Analytics, which counts page loads without
cookies. Three things switch it on:

1. Cloudflare dashboard → Analytics & Logs → Web Analytics → Add a site →
   enter the public hostname (`kalaayanastudios.com`), choose the JavaScript
   snippet. Copy the **token** from the snippet and the site's **site tag**
   (on the site's page; also the `siteTag` in the dashboard URL).
2. Put the token in `src/data/site.json` under `analytics.cloudflareBeaconToken`
   and commit: every page then loads the beacon. The token is public by design.
3. Put the site tag in `wrangler.jsonc` as `CF_WEB_ANALYTICS_SITE_TAG`, and add
   **Account · Account Analytics · Read** to the `CF_API_TOKEN` token's
   permissions (edit the token in My Profile → API Tokens).

Until all three are in place the tab explains what is missing.

## Roles and invitations

Who may sign in, and as what, is `admin/users.json` in the repository, so
every invitation is a versioned, logged change. Two roles:

|                                                      | Superadmin | Admin |
| ---------------------------------------------------- | ---------- | ----- |
| Add and update projects and photographs              | yes        | yes   |
| Delete projects                                      | yes        | no    |
| Homepage works; create, edit, delete works           | yes        | no    |
| Preview and accept their own changes                 | yes        | yes   |
| **Log** tab: the content log and every accept/reject | yes        | no    |
| **Users** tab: invite, change role, remove           | yes        | no    |

The Worker enforces the role on every request; an admin who sends a change
to the homepage gets it refused, not just hidden. The file must always hold
at least one superadmin; the admin will not let you remove the last one.

**Inviting someone** (Users tab): enter the email and the role. On staging
they then open the staging address, Cloudflare Access emails them a
one-time code, and the Worker lets them in with that role. Their email
must also be allowed by the Access policy: either list it there too, or
set the policy to allow a group or domain the Worker then narrows. If
`admin/users.json` is missing, `ADMIN_EMAILS` in `wrangler.jsonc` acts as
the superadmin list so the first superadmin can invite the rest.

## The log — who did what, and it cannot be taken back

Every sign-in, content change, users change and error is a line in
`logs/admin-log.jsonl` (one JSON object per line) with a matching human
line in `CONTENT-LOG.md`, both committed to the repository. `scripts/check.py`
fails any change that removes or alters an existing line or deletes a
sign-in photograph, and the branch rules forbid force pushes, so the log
can only grow.

**Shared accounts.** `contact@kalaayanastudios.com` is always a superadmin —
it cannot be removed or demoted — and may be used by several people. So
after every sign-in the admin asks _who is using this account_: the name
is required, and if the device has a camera a photograph is taken (skipped
automatically when there is none). Both are logged, and the name is
attached to everything done in that session ("Accepted by Priya
(contact@…)").

**Filtering** (Log tab, superadmins): by date range, user (name or email),
type — site content, admin (users), sign-ins, errors — and free text.
Sign-in photographs show as thumbnails and open full size.

On staging each log entry is a commit on `develop`; because the branch
requires pull requests, the Worker opens a tiny PR that merges itself once
CI passes, so an entry appears there within a minute or two.

## Using it

Open `https://kalaayana.shrenikyd.workers.dev/admin/`, sign in through Access. Two tabs:

- **Homepage** — the _works_ shown under WORKS on the homepage, in order
  (Temple Architecture, Portraits, Murals…). Each has an eyebrow, a name,
  a link, a photograph and **framing**: the photograph shows whole with the
  crop the site will use drawn over it; drag the frame to the part that
  should show, switching between the desktop and phone crops.
  **+ Add a work** asks for the name, eyebrow, one line and a cover
  photograph, then creates the work on the homepage _and_ in the Projects
  tab, ready for its projects. _Remove from homepage_ takes a work off the
  homepage without deleting it. _Projects in this work →_ jumps to them.
- **Projects** — the works in the sidebar, each with its projects. Click a
  project to edit its title, slug, scale, work, description and
  photographs; drop photographs to add them, every one needs alt text; the
  first is the **cover** shown in grids, and _Set as cover_ moves any other
  there. **+ New project** asks for the work first. _Edit work_ changes the
  work's text and banner (choose any project photograph with _Use an
  existing photograph_, or upload) and its framing; _Delete work_ removes
  its page and its homepage tile.
- **Preview & publish** never saves blind. It builds the page as the site
  will show it, opens it, and asks you to decide:
  - locally: **Accept & save** writes the files and adds a line to
    `CONTENT-LOG.md` — time, who, what changed, the preview accepted — which
    goes into git with the change; **Keep editing** saves nothing.
  - on staging: the change is proposed as a pull request that does not merge
    on its own; Cloudflare builds it; **Accept & publish** records your
    email and the time on the pull request and merges it (staging rebuilds
    in three or four minutes); **Reject** closes it and deletes its branch.
    `CONTENT-LOG.md` carries the proposal line; the commit carries the
    author and time; the pull request carries the decision.
    Problems found by validation are listed and nothing is saved until they
    are fixed.

**Looking without deciding.** _Preview this page_ in the top bar opens the
page being edited as the site will show it, without saving anything.

**Who can sign in.** Cloudflare Access shows the sign-in page (one-time code
by email, or Google) and only lets through the emails in its policy; the
Worker then checks the same email against `ADMIN_EMAILS`. Anyone else sees
_Not authorised_ with a link to sign in with another account. In the local
demo the sign-in page is the admin's own; allowed addresses come from
`DEMO_ADMINS` (comma-separated), default `demo@localhost,studio@kalaayanastudios.com`.

Removed photographs are deleted from the repository in the same commit, so
`git log` on `src/images/projects/` is the history of every image.

## Trying it without Cloudflare or GitHub

```
npm run admin:demo
```

opens the admin at http://localhost:8788/admin/ against your working tree.
Saves are validated exactly as on staging, then written straight into the
project files (`src/data/*.json`, `src/images/`), so they persist and show
up in `git status`: commit and push them to publish. Works on Windows
without Git Bash.

## Local development against the real Worker

```
cp .dev.vars.example .dev.vars   # then fill in GITHUB_TOKEN and DEV_EMAIL
npm run build:staging            # needs bash (Git for Windows) and python on PATH
npx wrangler dev
```

`DEV_EMAIL` skips the Access check **only** when the request comes from
`localhost`; it has no effect on a deployed Worker.
