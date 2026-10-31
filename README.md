# Piano Pal

A static, mobile-first piano practice coach. It can be deployed directly to GitHub Pages (no build step and no backend).

## What it does

- Provides a large, interactive music staff with treble and bass clef selection.
- Lets the player drag vertically on the staff and release to position a highlighted notehead.
- Defaults the accidental selector to natural (♮); sharps and flats can be selected before placing notes.
- Builds melodies one note at a time or groups several notes into a chord before adding the chord. Chords can include notes from both clefs.
- Shows the current expected note or chord on a grand staff during practice.
- Uses the device microphone and a piano-specific pitch model to check played notes. Correct notes advance automatically; incorrect pitches briefly appear in red on the practice staff.
- Works as a static PWA and is designed for iOS Safari over HTTPS.

## Deploy to GitHub Pages

1. Copy `index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`, and `apple-touch-icon.png` into the root of your GitHub Pages repository (or into a project folder such as `/piano-pal/`).
2. Commit and push.
3. Open the published HTTPS URL on an iPhone or iPad in Safari.
4. Use Share → Add to Home Screen to install it like an app.
5. Allow microphone access when prompted. The first time the piano detector is used, the browser downloads its model/runtime assets from jsDelivr.

No build command is required. Microphone access needs HTTPS (GitHub Pages provides HTTPS) or localhost. An internet connection is needed the first time the pitch detector loads.

## Creating a music path

1. Choose Treble or Bass.
2. Select Natural, Sharp, or Flat. Natural is selected by default.
3. Drag up or down on the large staff, then release. The highlighted notehead shows the selected pitch.
4. Select **Add note** to add it to the sequence.
5. For a chord, select **Build a chord**, place each note (switch between clefs when needed), then select **Add chord**.
6. Remove individual steps with the × button, or use **Clear all** to start over.

## Practice

1. Select **Start practice** and allow microphone access.
2. Play the note or chord displayed on the grand staff.
3. Correct pitches advance to the next step. A wrong pitch is briefly highlighted in red on the staff.

The app checks pitch only. It does not check note lengths, rhythm, dynamics, expression, or key signatures. Accidentals must be entered manually. Microphone pitch detection can be affected by room noise, reverberation, very soft notes, or overlapping sounds.

## Files

- `index.html` — complete single-page application
- `manifest.webmanifest` — installable PWA metadata
- `sw.js` — caches the app shell for repeat visits
- `icon.svg`, `apple-touch-icon.png` — app icons
