# 修复主目录为软链接的 SSH 机器连接

Date: 2026-11-06
Type: fix
Scope: server

[English](2026-11-06-ssh-symlink-home.md)

主目录为软链接的 SSH 机器现在可以响应服务命令并建立连接。远端命令会保留启动器的主入口路径，使已有安装正常启动，修复命令无输出就退出的问题。
