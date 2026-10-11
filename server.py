#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote
import argparse
import base64
import json
import mimetypes
import re
import subprocess
import time

APP_DIR = Path(__file__).resolve().parent
MAX_REQUEST = 15 * 1024 * 1024

class Handler(SimpleHTTPRequestHandler):
    workspace = None
    board_file = None
    media_dir = None
    repo_base = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > MAX_REQUEST:
            raise ValueError("Invalid request size")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _serve_media(self, request_path):
        rel = unquote(request_path.removeprefix("/workspace-media/"))
        if not rel or "/" in rel or "\\" in rel:
            return self.send_error(404)
        target = (self.media_dir / rel).resolve()
        if target.parent != self.media_dir.resolve() or not target.is_file():
            return self.send_error(404)
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        raw = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _run_git(self, *args, timeout=30):
        return subprocess.run(
            ["git", "-C", str(self.workspace), *args],
            text=True,
            capture_output=True,
            timeout=timeout,
        )

    def _git_failure(self, result, fallback):
        detail=(result.stderr or result.stdout or fallback).strip()
        return self._json(400, {"ok": False, "error": detail})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/config":
            return self._json(200, {
                "workspaceName": self.workspace.name,
                "workspacePath": str(self.workspace),
                "repoBase": self.repo_base,
            })
        if path == "/api/git-status":
            try:
                inside = self._run_git("rev-parse", "--is-inside-work-tree")
                if inside.returncode != 0 or inside.stdout.strip() != "true":
                    return self._json(200, {"isGitRepo": False})

                branch = self._run_git("branch", "--show-current")
                status = self._run_git("status", "--porcelain")
                remote = self._run_git("remote", "get-url", "origin")

                changes = [line for line in status.stdout.splitlines() if line.strip()]
                return self._json(200, {
                    "isGitRepo": True,
                    "branch": branch.stdout.strip(),
                    "clean": len(changes) == 0,
                    "changedCount": len(changes),
                    "remote": remote.stdout.strip() if remote.returncode == 0 else "",
                })
            except Exception as exc:
                return self._json(500, {"error": str(exc), "isGitRepo": False})

        if path == "/api/board":
            try:
                if not self.board_file.exists():
                    return self._json(404, {"error": "board-data.json not found in workspace"})
                return self._json(200, json.loads(self.board_file.read_text("utf-8")))
            except Exception as exc:
                return self._json(500, {"error": str(exc)})
        if path.startswith("/workspace-media/"):
            return self._serve_media(path)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        payload = {}
        if path in ("/api/board", "/api/image", "/api/git-commit"):
            try:
                payload = self._read_json()
            except Exception as exc:
                return self._json(400, {"error": str(exc)})

        if path == "/api/git-pull":
            result=self._run_git("pull","--ff-only",timeout=60)
            if result.returncode != 0:
                return self._git_failure(result,"Git pull failed")
            message=(result.stdout or "Book repo is already up to date.").strip()
            summary = "Book repo is already up to date." if "Already up to date" in message else "Latest book updates downloaded."
            return self._json(200, {"ok": True, "message": message, "summary": summary})

        if path == "/api/git-commit":
            message=str(payload.get("message","")).strip()
            if not message:
                return self._json(400, {"ok": False, "error": "Commit message is required."})

            add=self._run_git("add","-A",timeout=60)
            if add.returncode != 0:
                return self._git_failure(add,"Could not stage book changes")

            staged=self._run_git("diff","--cached","--quiet")
            if staged.returncode == 0:
                return self._json(200, {"ok": True, "message": "No book changes to save.", "summary": "No new book changes to save."})
            if staged.returncode not in (0,1):
                return self._git_failure(staged,"Could not check staged changes")

            commit=self._run_git("commit","-m",message,timeout=60)
            if commit.returncode != 0:
                return self._git_failure(commit,"Git commit failed")
            return self._json(200, {"ok": True, "message": (commit.stdout or "Book version saved.").strip(), "summary": "Version saved to the book repo."})

        if path == "/api/git-push":
            result=self._run_git("push",timeout=120)
            if result.returncode != 0:
                return self._git_failure(result,"Git push failed")
            message=(result.stderr or result.stdout or "Book repo pushed to GitHub.").strip()
            return self._json(200, {"ok": True, "message": message, "summary": "Book repo pushed to GitHub."})

        if path == "/api/board":
            if not isinstance(payload, dict) or "folders" not in payload or "items" not in payload:
                return self._json(400, {"error": "Invalid board data"})
            tmp = self.board_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", "utf-8")
            tmp.replace(self.board_file)
            return self._json(200, {"ok": True, "saved": str(self.board_file)})

        if path == "/api/image":
            name = str(payload.get("filename", "image"))
            data_url = str(payload.get("dataUrl", ""))
            match = re.fullmatch(r"data:([^;,]+);base64,(.+)", data_url, flags=re.S)
            if not match:
                return self._json(400, {"error": "Invalid image data"})

            mime, encoded = match.groups()
            try:
                raw = base64.b64decode(encoded, validate=True)
            except Exception:
                return self._json(400, {"error": "Invalid base64 image"})

            if len(raw) > 10 * 1024 * 1024:
                return self._json(413, {"error": "Image is larger than 10 MB"})

            ext = mimetypes.guess_extension(mime) or Path(name).suffix or ".img"
            if ext == ".jpe":
                ext = ".jpg"
            stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(name).stem).strip("-") or "image"
            filename = f"{int(time.time() * 1000)}-{stem}{ext}"
            target = self.media_dir / filename
            target.write_bytes(raw)
            return self._json(200, {"ok": True, "path": f"/workspace-media/{filename}"})

        return self._json(404, {"error": "Not found"})

    def log_message(self, fmt, *args):
        print("[Dreamwalker]", fmt % args)

def main():
    parser = argparse.ArgumentParser(description="Run Dreamwalker against a separate book workspace.")
    parser.add_argument("--workspace", required=True, help="Path to the book/project workspace")
    parser.add_argument("--repo-base", default="", help="Optional GitHub blob URL prefix for source links")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    workspace = Path(args.workspace).expanduser().resolve()
    if not workspace.is_dir():
        raise SystemExit(f"Workspace does not exist: {workspace}")

    dreamwalker_dir = workspace / ".dreamwalker"
    media_dir = dreamwalker_dir / "media"
    board_file = dreamwalker_dir / "board-data.json"
    dreamwalker_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)

    Handler.workspace = workspace
    Handler.board_file = board_file
    Handler.media_dir = media_dir
    Handler.repo_base = args.repo_base.rstrip("/") + "/" if args.repo_base else ""

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Dreamwalker: http://127.0.0.1:{args.port}")
    print(f"Workspace: {workspace}")
    print(f"Board data: {board_file}")
    print(f"Media: {media_dir}")
    print("Press Control+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
