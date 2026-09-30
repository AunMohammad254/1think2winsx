# Hostinger Deployment Guide

> **This document defines the exact process for deploying 1Think2Win to Hostinger.**  
> Follow every step in order. Do not skip or substitute any step.

---

## Prerequisites

- You are on the `main` branch (all feature branches must be merged first)
- Your working tree is **clean** (`git status` shows nothing to commit)
- You have run `bun install` locally and the project builds without errors

---

## Step 1 — Verify & Commit All Changes

Before generating the ZIP, make sure every change is committed to `main`.

```powershell
# Check what branch you are on
git branch

# Switch to main if not already there
git checkout main

# Check for any uncommitted changes
git status
```

If there are **uncommitted changes**:

```powershell
# Stage all changes
git add -A

# Commit with a descriptive message
git commit -m "feat/fix: <your description here>"
```

If there are changes sitting on a **feature branch**, merge them first (see Step 1a).

### Step 1a — Merge a Feature Branch into Main

```powershell
# Switch to main
git checkout main

# Merge with a merge commit (no fast-forward) for a clear history
git merge <branch-name> --no-ff -m "merge: <branch-name> into main"
```

> Resolve any merge conflicts before continuing.

---

## Step 2 — Run a Local Production Build (Verification)

Always verify the build succeeds locally before deploying.

```powershell
bun run build
```

**Expected output:**
- `Compiled successfully`
- `Generating static pages (N/N)`
- A route table printed at the end with all pages listed
- `.next/standalone` and `.next/static` directories created

> **Do NOT proceed if the build fails.** Fix the errors first.

---

## Step 3 — Generate the Hostinger ZIP

> ### CRITICAL RULE — Always use `git archive`, NEVER `Compress-Archive` or any Windows ZIP tool
>
> Windows ZIP tools (`Compress-Archive`, WinRAR, 7-Zip GUI, etc.) do **not** embed Unix file permissions.
> When Hostinger extracts a Windows-created ZIP on its Linux server, directories can end up with `chmod 000`
> (no read/execute permission), causing the build to fail with:
>
> `EACCES: permission denied, scandir .../src/app/api/admin`
>
> `git archive` always writes proper Unix permissions (`755` for directories, `644` for files).

```powershell
# Remove any existing ZIP first
if (Test-Path "hostinger-deploy.zip") { Remove-Item "hostinger-deploy.zip" -Force }

# Generate the ZIP from the current HEAD (main branch)
git archive --format=zip --output=hostinger-deploy.zip HEAD

# Confirm it was created and check its size
$zip = Get-Item "hostinger-deploy.zip"
Write-Host "Size: $([math]::Round($zip.Length / 1MB, 2)) MB"
```

### What `git archive` automatically includes / excludes

| Included | Excluded |
|----------|----------|
| `src/` | `node_modules/` |
| `public/` | `.next/` (build output) |
| `package.json` | `.env` (secrets) |
| `next.config.js` | `.env.production` (secrets) |
| `tsconfig.json` | `.git/` |
| `bun.lock` | `server.js` (standalone artifact) |
| `.env.example` | Any file listed in `.gitignore` |
| `postcss.config.mjs` | |
| `eslint.config.mjs` | |

> `git archive` only packages files that are **tracked by Git** — anything in `.gitignore` is automatically excluded.

---

## Step 4 — Verify the ZIP Contents

Run this quick check to confirm the ZIP is correct before uploading:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead("hostinger-deploy.zip")
$entries = $archive.Entries

# Show top-level structure
Write-Host "=== Top-level items ==="
$entries | ForEach-Object { ($_.FullName -replace '\\','/').Split('/')[0] } |
    Sort-Object -Unique | ForEach-Object { Write-Host "  $_" }

# Critical file checks
Write-Host "`n=== Critical files ==="
@('package.json','next.config.js','src/','public/') | ForEach-Object {
    $f = $_
    if ($entries | Where-Object { $_.FullName -like "$f*" }) {
        Write-Host "  [OK] $f"
    } else {
        Write-Host "  [MISSING] $f"
    }
}

# Security checks — these must NOT be present
Write-Host "`n=== Security checks (must all say excluded) ==="
@('.env','node_modules','.next','server.js') | ForEach-Object {
    $u = $_
    if ($entries | Where-Object { $_.FullName -eq $u -or $_.FullName -like "${u}/*" }) {
        Write-Host "  [WARNING] $u IS PRESENT — remove it!"
    } else {
        Write-Host "  [OK] $u excluded"
    }
}

Write-Host "`nTotal entries: $($entries.Count)"
$archive.Dispose()
```

**Expected results:**
- `[OK]` for all critical files
- `[OK] excluded` for all security checks (especially `.env` and `node_modules`)

---

## Step 5 — Upload to Hostinger hPanel

1. Log in to **hPanel** → go to your website → **Node.js / Web App** section
2. Click **Deploy** (or re-deploy)
3. Choose **Upload ZIP file**
4. Upload `hostinger-deploy.zip` from the project root
5. Confirm these build settings in hPanel:

| Setting | Value |
|---------|-------|
| **Node.js version** | 20.x or 22.x (LTS) |
| **Package manager** | npm (auto-detected) |
| **Build command** | `npm run build` |
| **Start command** | `npm run start` |
| **Output directory** | `.next` |
| **Entry file** | *(leave as auto / none)* |

---

## Step 6 — Set Environment Variables in hPanel

**Never put `.env` files in the ZIP.** Add all variables manually in hPanel:

> hPanel → Website → Node.js App → **Environment Variables**

Copy values from your local `.env.production` and add them one by one. Required variables:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
DIRECT_URL
AUTH_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
NEXT_PUBLIC_SITE_URL
BREVO_API_KEY
BREVO_SENDER_EMAIL
ADMIN_EMAILS
ADMIN_PASSWORD
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
WALLET_FEATURE_ENABLED
NEWSLETTER_UNSUBSCRIBE_SECRET
CRON_SECRET
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
```

---

## Step 7 — Trigger Deploy & Monitor the Build Log

After uploading the ZIP and confirming env vars, click **Deploy** in hPanel.

A successful deploy log looks like:

```
==> Installing dependencies
Dependencies installed in ~25s

==> Building
Compiled successfully
Generating static pages (86/86)

==> Build complete
```

---

## Quick Reference — One-Command ZIP Generation

Once you are on `main` with a clean working tree:

```powershell
if (Test-Path "hostinger-deploy.zip") { Remove-Item "hostinger-deploy.zip" -Force }
git archive --format=zip --output=hostinger-deploy.zip HEAD
Write-Host "Done: $([math]::Round((Get-Item 'hostinger-deploy.zip').Length / 1MB, 2)) MB"
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `EACCES: permission denied, scandir .../src/app/api/admin` | ZIP was created with a Windows tool | Regenerate using `git archive` — never use Windows ZIP tools |
| `Error: Cannot find module 'X'` | Dependency missing from `package.json` | Run `bun add X`, commit, regenerate ZIP |
| `Build error: Environment variable not found` | Missing env var in hPanel | Add the missing variable under hPanel → Environment Variables |
| `ENOENT: no such file or directory` | File not tracked in Git | `git add <file>`, commit, regenerate ZIP |
| ZIP extracts into a subfolder on Hostinger | ZIP wraps a folder instead of its contents | `git archive` always puts files at the ZIP root — this is not an issue with `git archive` |

---

*Last updated: 2026-09-30 — applies from the `perf-scale-50k` -> `main` merge onward.*
