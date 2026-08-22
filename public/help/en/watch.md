# Web Watch

Web Watch detects when public web pages change using content hashes — handy
for pages without RSS: pricing pages, announcements, documentation updates.

## How to use

1. Click "Add watcher", enter a name and the page URL to watch.
2. The page is fetched once and the current content hash becomes the baseline.
3. Click "Check all" (or a single watcher) to re-fetch and compare.
4. When content changes, the watcher shows "Changed"; after a confirming
   check, the new hash becomes the baseline.

## Notes

- Only publicly accessible pages can be watched; login- or CAPTCHA-gated
  pages cannot be fetched.
- Checks are manual while the app is open; no background service is used.
- Change detection is hash-based, so dynamic regions such as timestamps or
  counters may flag frequent changes — consider whether hash monitoring fits.
