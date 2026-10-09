# Silvan - notes for Claude sessions

- **You can run and test the game.** Headless Chromium + Playwright are
  preinstalled in the cloud container and WebGL works in software. Read
  `HEADLESS_TESTING.txt` before telling the owner something is untestable or
  "build-verified only". A script is in `tools/e2e/phone-test.mjs`.
- The owner usually plays on a phone. Check phone viewports (412x780,
  360x640, 780x360) after any UI or layout change.
- Bugs are logged in `SILVAN_BETA2_AUDIT.txt` (latest: B-31). Use the next free
  number; do not reuse IDs.
- Say plainly what was tested and what wasn't (feel, real fonts, audio).
