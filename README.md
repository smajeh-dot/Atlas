# Atlas

Atlas is a flashcard app for Windows that shows you each card just before you'd forget it. It uses the same FSRS scheduling as Anki, with a simpler, friendlier interface.

## Download

Get `Atlas.exe` from the [latest release](https://github.com/smajeh-dot/atlas/releases/latest). There is nothing to install: double-click it to run.

## First launch

Atlas isn't signed with a paid certificate, so the first time you open it Windows shows **"Windows protected your PC"**. Click **More info**, then **Run anyway**. Windows remembers this for that copy of the file.

Atlas needs Microsoft WebView2, which comes with Windows 11 and up-to-date Windows 10. If Atlas doesn't open, install the WebView2 Runtime from [Microsoft's download page](https://developer.microsoft.com/microsoft-edge/webview2/).

## Your data

Everything Atlas stores lives in `%APPDATA%\Atlas` (paste that into File Explorer's address bar):

- `atlas.db`: your decks, cards and review history
- `media\`: pictures and sounds used on your cards
- `backups\`: a copy of `atlas.db` that Atlas saves just before each import, named `pre-import-<number>.db`
- `tmp\`: working space while an import runs; Atlas empties it itself

Replacing or moving `Atlas.exe` never touches this folder. To back up your cards or move to a new laptop, close Atlas and copy the whole `Atlas` folder (into `%APPDATA%` on the new laptop).

To put a pre-import backup back: close Atlas, then in File Explorer rename `atlas.db` to something else (for example `atlas-before-restore.db`), copy the backup from `backups\` into the `Atlas` folder, and rename the copy to `atlas.db`.

## Coming from Anki

Atlas imports Anki deck packages (`.apkg`) with your review history, so cards come due when Anki would have shown them.

1. In Anki, choose **File → Export**.
2. Set the format to **Anki Deck Package (.apkg)**, tick **Include scheduling information** and **Include media**, and save the file.
3. In Atlas, click **Import from Anki** on the welcome screen (or, once you have decks, click **Import** in the bar at the top of the Home screen), then **Choose a file…**. Atlas shows what's in the file before changing anything; click **Import**.

If Atlas says the file was exported in a way it can't read, export again in Anki with **Support older Anki versions** ticked.

What comes across: decks (including subdecks), notes, cards, tags, note types, pictures and sounds, flags, suspended cards, and every review, with each card's due date, interval, lapses and reps. Atlas uses the FSRS memory state Anki stored, or works it out from your review history.

What doesn't, yet: sound playback, LaTeX maths, Image Occlusion masks (the notes and their history are imported), and a few template features. The import report lists anything like this it found. Filtered decks aren't recreated; their cards go back to their own decks.

Importing is safe to repeat: notes you already have are left exactly as they are, progress and all, and only new notes and cards are added. If an import fails or you press **Cancel**, Atlas undoes everything it did, and if Atlas is closed in the middle of one, it undoes it the next time it opens.

## Equations

Write equations in LaTeX the way Obsidian does:

| Write | Shows |
|---|---|
| `$x^2$` | an equation inside the sentence |
| `$$x^2$$` | an equation on its own centred line |
| `\$` | a plain dollar sign |

Prices are left alone: in `It costs $5 and $10` neither dollar starts an equation, because an equation's opening `$` can't be followed by a space and its closing `$` can't be preceded by one or followed by a digit. Anki's `\( \)` and `\[ \]` keep working. Chemistry works with `\ce{…}`, for example `$\ce{2H2 + O2 -> 2H2O}$`. A cloze can sit inside an equation: `$E = {{c1::mc^2}}$`.

## Build from source

In Windows PowerShell, install [Node.js LTS](https://nodejs.org) and [Rust](https://rustup.rs), then:

```powershell
npm ci
npm test
npm run tauri build -- --no-bundle
```

The app is written to `src-tauri\target\release\atlas.exe`.

## Licence

MIT. See [LICENSE](LICENSE).
