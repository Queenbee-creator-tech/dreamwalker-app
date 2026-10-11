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


## Book repository connection

Dreamwalker now detects whether the selected workspace is a Git repository and displays its current branch and whether local changes exist.

This first connection is intentionally read-only for Git operations. Dreamwalker can inspect the book repo status, but it does not yet pull, commit, or push automatically. Those controls can be added after the local connection is verified.


## Book Git controls

Dreamwalker now exposes three explicit Git actions for the selected book workspace:

- **Get Latest** runs a fast-forward-only pull for the book repo.
- **Save Version** saves the current Dreamwalker board state, stages all book-repo changes, and creates a Git commit using the message Zoe provides.
- **Push to GitHub** pushes committed book changes to the repo's configured remote.

These controls operate on the selected book workspace only. They do not change the Dreamwalker app development repo.


## Temporary migration copies

During the original app/book separation, local copies may exist at `data/` and `assets/uploads/` inside the app folder. Those paths are ignored by Git and are not part of the Dreamwalker application. After the book workspace migration is verified, they can be deleted locally.

The authoritative visual workspace belongs under the selected book workspace's `.dreamwalker/` directory.
