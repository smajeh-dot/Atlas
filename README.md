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
- `media\`: images and audio used on your cards
- `backups\`: reserved for automatic backups, which arrive in a later version

Replacing or moving `Atlas.exe` never touches this folder. To back up your cards or move to a new laptop, close Atlas and copy the whole `Atlas` folder (into `%APPDATA%` on the new laptop).

## Coming from Anki

Importing Anki decks with their review history arrives in a later version. When it does: in Anki, choose **File → Export**, tick **Include scheduling information**, and import the file in Atlas.

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
