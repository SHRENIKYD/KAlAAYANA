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

Put both in `wrangler.jsonc` under `vars` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`)
and list the editors' emails in `ADMIN_EMAILS`, comma-separated. These are not
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

### 4. Let saves merge themselves (optional)

GitHub → repository Settings → General → Pull Requests → tick
**Allow auto-merge**. Each save then merges on its own once CI passes. Without
it the admin shows the pull request link and you merge it by hand.

## Using it

Open `https://<staging host>/admin/`, sign in through Access.

- **Sections** are in the sidebar. _Edit section_ changes the eyebrow, title,
  lede and banner. _New section_ needs a key (becomes `/<key>/`), the text,
  and a banner photograph. A new section gets its own page and project pages
  automatically; linking it from the homepage is a code change.
- **Projects** are cards. Click one to edit the title, slug, scale, section,
  description and photographs. Drop photographs on the editor to add them;
  every photograph needs alt text. Reorder with the arrows; the first is the
  **cover** — the photograph that stands for the project in section grids —
  and _Set as cover_ on any other photograph moves it there.
- A section's **banner** (its face on the section page) can be chosen from any
  project photograph with _Use an existing photograph_, or uploaded. Choosing
  an existing one copies it into the section's banner slot; the original stays
  with its project.
- **Homepage** (top of the sidebar) is the WORKS list: order, eyebrow, title,
  link target, link text and photograph for each feature, plus **framing** —
  click the photograph where the subject is and the desktop and phone crops
  follow. Section banners have the same framing control.
- **Save & publish to staging** validates everything the way CI does, then
  commits. Problems are listed and nothing is saved until they are fixed.
  A saved change shows on staging three or four minutes after the pull
  request merges.

**Seeing the result.** After a save, Cloudflare builds the pull request's
branch and posts its preview URL as a comment on the PR within a few minutes:
that is the site exactly as it will look. In the local demo, **Preview site**
in the save dialog runs the real build with your saved changes and opens it.

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
Saves are validated exactly as on staging, then written to `.admin-demo/`
instead of committed. Works on Windows without Git Bash.

## Local development against the real Worker

```
cp .dev.vars.example .dev.vars   # then fill in GITHUB_TOKEN and DEV_EMAIL
npm run build:staging            # needs bash (Git for Windows) and python on PATH
npx wrangler dev
```

`DEV_EMAIL` skips the Access check **only** when the request comes from
`localhost`; it has no effect on a deployed Worker.
