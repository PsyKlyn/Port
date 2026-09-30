# Sardhon Static Portfolio

The portfolio includes a single **Write-ups** page (`writeups.html`).

- The homepage renders the first three write-ups and links to the Write-ups page.
- The Write-ups page starts as a card grid.
- Selecting a write-up rearranges that same page into a left write-up list and a right article reader; it does not navigate to a separate article page.
- A selected write-up can also be opened directly with `writeups.html?slug=...`.
- Published editor entries are read from `localStorage` and their generated article HTML is rendered inside the reader.
- Physical published write-ups created by the editor remain under `Write-ups/<title>/index.html` with their related assets.


## Local publishing

The Editor uses the browser File System Access API for physical publishing. Because browsers cannot turn a `file:///C:/.../editor.html` URL into a writable filesystem handle, the first Publish action asks you to select the `Sardhon_Static_Portfolio` folder. The selected folder is verified by checking for `editor.html` and `writeups.html`.

Each publish creates/updates:

- `Write-ups/<Write-up Title>/index.html` — the standalone write-up page.
- `Write-ups/writeup.css` — the shared write-up stylesheet used by every published page.
- `js/writeups.js` — the local catalogue, including the rendered write-up body so the same-page reader works from `file://` without fetch().

The generated article contains exactly one metadata/title/intro header: the Editor preview HTML is reused directly, so published output and preview stay in sync.


### Published write-up assets
Published pages use the shared `Write-ups/writeup.css` stylesheet and `Write-ups/images/` directory. New screenshots/evidence are copied there when a write-up is published.


## Publishing write-ups

Open `editor.html` in Chrome or Edge. Click **Connect Portfolio Folder** once and select the
`Sardhon_Static_Portfolio` folder itself (the folder containing `editor.html` and `writeups.html`).
The permission is remembered by the browser.

When **Publish Write-up** is clicked, the editor physically creates/updates:

```text
Write-ups/
├── writeup.css
├── images/
└── <Write-up Title>/
    └── index.html
```

Images selected in the editor are copied into `Write-ups/images/` and the published article
references them with `../images/<filename>`. The publish operation verifies the saved HTML,
shared CSS, and every selected image before reporting success.

The Write-ups reader keeps its search bar and tags visible while the selected article has its
own scrollbar.
