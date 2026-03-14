# Custody Tracker — Gunderson v. Winkels

A full-featured custody tracking app for Zeke and Gus.

## Features
- **Court order schedule engine** — auto-fills per the custody order
- **Per-child tracking** — Zeke and Gus tracked independently (daytime + overnight)
- **Evidence logging** — text messages, emails, documents, photos with file attachments
- **From contacts** — Kelly (Ex), James (Ex's Husband), Attorney, School, Court, custom
- **Camera & screenshot capture** — take photos or pick screenshots directly from phone
- **Documents vault** — store custody plans, court orders, key reference files
- **Custody exchanges** — log pickups/dropoffs with time, location, notes
- **Bulk date entry** — set custody for a range of dates at once
- **Summary** — per-child daytime/overnight split percentages
- **Export/Import** — JSON backup + CSV evidence export
- **Installable PWA** — add to home screen on phone, works offline

## Deploy to GitHub Pages (5 minutes)

### Step 1: Create a GitHub account (if you don't have one)
1. Go to **github.com** and sign up (free)

### Step 2: Create a new repository
1. Click the **+** in the top right → **New repository**
2. Name it: `custody-tracker`
3. Set it to **Public** (required for free GitHub Pages)
4. Check **"Add a README file"**
5. Click **Create repository**

### Step 3: Upload the app files
1. In your new repo, click **"Add file"** → **"Upload files"**
2. Drag ALL these files into the upload area:
   - `index.html`
   - `app.js`
   - `manifest.json`
   - `icon.svg`
   - `icon-192.png`
   - `icon-512.png`
3. Click **"Commit changes"**

### Step 4: Enable GitHub Pages
1. Go to your repo's **Settings** tab
2. In the left sidebar, click **Pages**
3. Under "Source", select **main** branch
4. Click **Save**
5. Wait ~1 minute, then your app is live at:
   **`https://YOUR-USERNAME.github.io/custody-tracker/`**

### Step 5: Install on your phone
1. Open that URL on your phone's browser
2. **iPhone**: Tap Share → "Add to Home Screen"
3. **Android**: Tap menu → "Add to Home Screen" or "Install"

## Cross-Device Data Sync

Data is stored locally in each browser using IndexedDB. To sync between devices:

1. On Device A: tap **Export** → saves a JSON backup file
2. Transfer that file to Device B (email, Drive, AirDrop)
3. On Device B: tap **Import** → select the backup file

For automatic real-time sync, you'd need to add a cloud database (Firebase, Supabase, etc.) — ask if you want help setting that up.

## Privacy
- All data stays on YOUR device
- Nothing is sent to any server
- GitHub Pages only hosts the app code, not your data
- Files/photos are stored in your browser's IndexedDB
