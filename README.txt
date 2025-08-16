Timer Jukebox — PWA
======================
Quick start
-----------
1) Unzip this folder.
2) Serve it over HTTP(S). Easiest: `npx serve@latest` from this folder.
3) Open the printed URL (e.g., http://localhost:3000). 
4) Use the app; click the Install button (Android/desktop) or on iOS: Share ▸ Add to Home Screen.

Notes
-----
- Works offline after first load (app shell cached). Remote audio URLs still require connectivity.
- iOS: background audio continues while the screen is off; use the hardware volume keys to adjust.
- If a pasted audio URL won't play, it's likely blocked by CORS. Upload a local file instead.
