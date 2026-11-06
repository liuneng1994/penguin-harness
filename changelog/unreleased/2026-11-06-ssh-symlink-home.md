# Connect to SSH machines with symlinked home directories

Date: 2026-11-06
Type: fix
Scope: server

[中文](2026-11-06-ssh-symlink-home.zh.md)

SSH machines whose home directory is a symbolic link can now answer server commands and connect. Remote commands preserve the bootstrap's main entry path so existing installations start correctly instead of exiting without output.
