# Piano Pal

A static, mobile-first piano practice coach. It can be deployed directly to GitHub Pages (no build step and no backend).

## What it does

- Takes a new photo with a phone camera or selects an existing screenshot/photo.
- Shows the sheet on screen. Calibrate the top and bottom staff lines for treble and/or bass, then tap noteheads from left to right to create the expected note path.
- Supports grouped notes/chords, sharps, flats, natural notes, and a quick typed-note mode.
- Imports uncompressed MusicXML (`.xml` / `.musicxml`) note pitches and chord groups.
- Listens through the device microphone and checks played pitches against the sequence with friendly right/wrong feedback.
- Works as a static PWA and is designed for iOS Safari over HTTPS.

## Deploy to GitHub Pages

1. Copy `index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`, and `apple-touch-icon.png` into the root of your GitHub Pages repository (or into a project folder such as `/piano-pal/`).
2. Commit and push.
3. Open the published HTTPS URL on the iPhone/iPad in Safari.
4. Use Share → Add to Home Screen to install it like an app.
5. Allow microphone access when prompted. The first time the piano detector is used, the browser downloads its small model/runtime assets from jsDelivr.

No build command is required. Camera and microphone access need HTTPS (GitHub Pages provides HTTPS) or localhost.

## How to enter notes from a photo

1. Upload the sheet photo.
2. Select Treble clef or Bass clef.
3. Tap **Set staff lines**, then tap the bottom staff line followed by the top staff line.
4. Select **Add notes** and tap noteheads from left to right. Set the accidental selector before each sharp or flat note; it resets to natural after one tap.
5. For a chord, tap **Build a chord**, tap all of its noteheads (switch clefs if needed), and tap **Finish chord**.
6. Review/correct pitches in **Your note path**, then start practice.

You can also type notes like `C4 D4 E4 C4` or chords like `C4+E4+G4 D4+F4+A4`.

## Current limitations

This version does not perform full automatic optical music recognition on a photo. The sheet photo is the visual reference and the player enters the pitches by tapping noteheads (or imports MusicXML). It checks pitches, not note lengths, rhythm, dynamics, or expression. Key signatures must be accounted for manually with the accidental selector. MusicXML import handles ordinary pitched notes and `<chord/>` groups but is a deliberately lightweight importer; review the imported note path, especially for multi-voice or complex scores.

The listening engine is a browser dependency loaded from jsDelivr (`@markusstrasser/pitchplease` 3.1.0), using its piano model. An internet connection is needed the first time it loads. As with any microphone pitch detector, very soft notes, room noise, reverberation, and overlapping instruments can affect accuracy.

## Files

- `index.html` — complete single-page application
- `manifest.webmanifest` — installable PWA metadata
- `sw.js` — caches the app shell for repeat visits
- `icon.svg`, `apple-touch-icon.png` — app icons
