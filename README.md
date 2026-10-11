# Dreamwalker

Dreamwalker is a private, local-first visual planning app for books and story projects.

It is the **software/tool**, not the book itself.

## Architecture

Dreamwalker opens a separate project folder as a workspace, similar to how Obsidian opens a vault.

```text
Dreamwalker app
  = software

dreamwalker-book
  = book project / workspace

GitHub
  = remote version history + collaboration
```

The app code belongs in this repository. Book-specific board data, uploaded images, canon, planning, research, and decisions belong in the separate book repository/workspace.

## Current local setup

On Zoe's Mac the intended sibling-folder layout is:

```text
~/Documents/GitHub/
├── dreamwalker-app/
└── dreamwalker-book/
```

Double-click `Start Dreamwalker.command` from the app repository. The launcher opens the sibling `dreamwalker-book` folder as the workspace.

Dreamwalker stores its workspace-specific visual data under:

```text
dreamwalker-book/.dreamwalker/
├── board-data.json
└── media/
```

The app itself does not need to live inside the book repository.

## Local-first

The app runs on `127.0.0.1` using a small Python server and opens in the browser. The browser is the interface; the data remains in the selected local workspace.

## Future direction

The local-first architecture can later evolve into a hosted version using a database for structured project data and object storage for images. The book repository can remain the source of truth for canon and manuscript/project files.

## Canon rule

A visual-board item is not canon merely because it exists in Dreamwalker. Zoe explicitly decides what is locked canon.
