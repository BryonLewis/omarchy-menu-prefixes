#!/bin/bash
# Opens a file with its default app.
#
# Plain `xdg-open` goes through xdg-desktop-portal, which on some systems
# hangs indefinitely when called from a process with no window context (e.g.
# a detached menu action). Non-terminal apps are launched with `gio launch`,
# which resolves the .desktop file via GLib without touching the portal.
# Terminal=true apps (e.g. nvim.desktop) need a real TTY, so those go through
# xdg-terminal-exec with an argv expanded by GLib's desktop-entry rules —
# never through `bash -c` after text-filtering Exec=.

path="$1"
[ -z "$path" ] && exit 1

mime=$(xdg-mime query filetype "$path" 2>/dev/null)
desktop_id=$(xdg-mime query default "$mime" 2>/dev/null)

desktop_file=""
for dir in "$HOME/.local/share/applications" /usr/share/applications /usr/local/share/applications; do
  if [ -n "$desktop_id" ] && [ -f "$dir/$desktop_id" ]; then
    desktop_file="$dir/$desktop_id"
    break
  fi
done

if [ -z "$desktop_file" ]; then
  exec xdg-open "$path"
fi

# Desktop-entry-aware launch: GLib expands Exec= field codes and quoting into
# an argv, then we exec that argv (wrapped in a terminal when needed).
exec python3 - "$desktop_file" "$path" <<'PY'
import os
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

try:
    from gi.repository import GioUnix
    DesktopAppInfo = GioUnix.DesktopAppInfo
except ImportError:
    DesktopAppInfo = Gio.DesktopAppInfo

desktop_file, path = sys.argv[1], sys.argv[2]
path = os.path.abspath(path)

info = DesktopAppInfo.new_from_filename(desktop_file)
if info is None:
    os.execvp("xdg-open", ["xdg-open", path])

if not info.get_boolean("Terminal"):
    os.execvp("gio", ["gio", "launch", desktop_file, path])


def expand_exec(commandline, file_path, desktop_path, name="", icon=""):
    """Expand a Desktop Entry Exec value the GLib way, then shell_parse_argv.

    Field-code substitutions are shell-quoted before parsing so paths never
    re-enter quoting syntax. The resulting argv is safe for execve — it is
    not passed through a shell.
    """
    s = commandline.replace("%%", "\x00")
    for code in ("%d", "%D", "%n", "%N", "%v", "%m"):
        s = s.replace(code, "")

    quoted_path = GLib.shell_quote(file_path) if file_path else ""
    quoted_uri = (
        GLib.shell_quote(GLib.filename_to_uri(file_path, None)) if file_path else ""
    )
    out = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "\x00":
            out.append("%")
            i += 1
            continue
        if ch == "%" and i + 1 < len(s):
            code = s[i + 1]
            if code in "fF":
                if file_path:
                    out.append(quoted_path)
                i += 2
                continue
            if code in "uU":
                if file_path:
                    out.append(quoted_uri)
                i += 2
                continue
            if code == "c":
                out.append(GLib.shell_quote(name))
                i += 2
                continue
            if code == "k":
                out.append(GLib.shell_quote(desktop_path))
                i += 2
                continue
            if code == "i":
                if icon:
                    out.append("--icon ")
                    out.append(GLib.shell_quote(icon))
                i += 2
                continue
        out.append(ch)
        i += 1

    ok, argv = GLib.shell_parse_argv("".join(out))
    if not ok or not argv:
        raise ValueError("failed to parse Exec")
    return list(argv)


commandline = info.get_commandline()
if not commandline:
    os.execvp("xdg-open", ["xdg-open", path])

argv = expand_exec(
    commandline,
    path,
    desktop_file,
    name=info.get_name() or "",
    icon=info.get_string("Icon") or "",
)
os.execvp("xdg-terminal-exec", ["xdg-terminal-exec", "--"] + argv)
PY
