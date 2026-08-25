#!/bin/bash
# Opens a file with its default app.
#
# Plain `xdg-open` goes through xdg-desktop-portal, which on some systems
# hangs indefinitely when called from a process with no window context (e.g.
# a detached menu action). `gtk-launch` resolves the .desktop file and execs
# it without touching the portal, so it works from anywhere. Terminal=true
# apps (e.g. nvim.desktop as the default text editor) additionally need a
# real TTY, which gtk-launch alone doesn't provide, so those are run via
# xdg-terminal-exec with the Exec= command extracted directly.

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
  xdg-open "$path"
elif command grep -q '^Terminal=true' "$desktop_file"; then
  exec_cmd=$(command grep '^Exec=' "$desktop_file" | head -1 | sed 's/^Exec=//; s/%[a-zA-Z]//g')
  xdg-terminal-exec bash -c '"$@"' bash $exec_cmd "$path"
else
  gtk-launch "${desktop_id%.desktop}" "$path"
fi
