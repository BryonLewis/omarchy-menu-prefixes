#!/bin/bash
# Opens a file with its default application.
#
# Plain `xdg-open` goes through xdg-desktop-portal, which on some systems
# hangs indefinitely when called from a process with no window context (e.g.
# a detached menu action). So the default application is resolved and launched
# here instead — but entirely through GIO, never by text-filtering
# mimeapps.list or a .desktop file:
#
#   - the content type and the default app for it come from GIO, so the
#     .desktop file is located by the desktop-entry implementation rather than
#     by guessing at a filename inside a list of directories;
#   - Terminal=false apps are handed to `gio launch`, which expands Exec= by
#     the desktop-entry rules;
#   - Terminal=true apps (nvim.desktop and friends) need a real TTY, so their
#     Exec= is expanded into an argv by those same rules and exec'd through
#     xdg-terminal-exec.
#
# Nothing read out of a .desktop file is ever passed to a shell, so a crafted
# Exec= line cannot be reinterpreted as command syntax.
#
# Anything the GIO path cannot answer — no python-gobject, no registered
# default, a .desktop file GIO refuses — falls back to xdg-open, so the file
# still opens on a machine that lacks the pieces.

set -u

path=${1-}
[ -n "$path" ] || exit 1
# A row whose path no longer exists has nothing to open. Checked here as well
# as at the producer so a stale locate index cannot send a launcher after a
# path that was never there.
[ -e "$path" ] || exit 1

# 97 is the helper's "I could not do this, use xdg-open" exit code. Any other
# status is the helper's own, and success means it exec'd and never returned.
if command -v python3 >/dev/null 2>&1; then
  python3 - "$path" <<'PY'
import os
import shutil
import sys

FALLBACK = 97


def fallback():
    sys.exit(FALLBACK)


def launch(argv):
    """execvp argv, first detaching stdin from this helper's own script.

    The helper is fed to python on stdin (the heredoc below), and an exec'd
    child would otherwise inherit that spent descriptor as its stdin.
    """
    try:
        devnull = os.open(os.devnull, os.O_RDONLY)
        os.dup2(devnull, 0)
        os.close(devnull)
    except OSError:
        pass
    try:
        os.execvp(argv[0], argv)
    except OSError:
        fallback()


try:
    import gi

    gi.require_version("Gio", "2.0")
    from gi.repository import Gio, GLib
except (ImportError, ValueError):
    fallback()

try:
    from gi.repository import GioUnix

    DesktopAppInfo = GioUnix.DesktopAppInfo
except (ImportError, ValueError):
    DesktopAppInfo = Gio.DesktopAppInfo

path = os.path.abspath(sys.argv[1])


def expand_exec(commandline, file_path, desktop_path, name="", icon=""):
    """Expand a Desktop Entry Exec value the GLib way, then shell_parse_argv.

    Field-code substitutions are shell-quoted before parsing so a path never
    re-enters quoting syntax, which is also what g_desktop_app_info_expand_macro
    does — the spec forbids a field code inside a quoted argument, so this
    agrees with `gio launch` for the entries that respect it.

    The result goes to execve, never to a shell, so ";", "|", "&&", "$(...)"
    and backticks in a crafted Exec= line end up as inert argv elements
    instead of command syntax.
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


def resolve_desktop_entry(file_path):
    """The entry GIO says handles this file, or None.

    Content type from GIO's own sniffing, then GIO's registered default
    handler for it. Neither step parses a configuration file here, and the
    .desktop path comes back from GIO rather than being assembled from a
    desktop id — so a crafted mimeapps.list cannot point this at a file
    outside the search path.
    """
    content_type = (
        Gio.File.new_for_path(file_path)
        .query_info("standard::content-type", Gio.FileQueryInfoFlags.NONE, None)
        .get_content_type()
    )
    if not content_type:
        return None
    default_app = Gio.AppInfo.get_default_for_type(content_type, False)
    if default_app is None:
        return None
    desktop_file = default_app.get_filename()
    if not desktop_file:
        return None
    return DesktopAppInfo.new_from_filename(desktop_file)


# Every failure below means the same thing — this helper cannot answer, so let
# xdg-open try — and there is no case where a traceback would serve the user
# better than the file opening.
try:
    info = resolve_desktop_entry(path)
except Exception:
    info = None

if info is None:
    fallback()

desktop_file = info.get_filename()

if not info.get_boolean("Terminal"):
    if shutil.which("gio") is None:
        fallback()
    launch(["gio", "launch", desktop_file, path])

commandline = info.get_commandline()
if not commandline or shutil.which("xdg-terminal-exec") is None:
    fallback()

try:
    argv = expand_exec(
        commandline,
        path,
        desktop_file,
        name=info.get_name() or "",
        icon=info.get_string("Icon") or "",
    )
except Exception:
    fallback()

launch(["xdg-terminal-exec", "--"] + argv)
PY
  status=$?
  if [ "$status" -ne 97 ]; then exit "$status"; fi
fi

exec xdg-open "$path"
