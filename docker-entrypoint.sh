#!/bin/sh
set -eu
# Тома Docker создаются с root; приложение идёт от пользователя node — без chown SQLite и сессия не пишутся.
mkdir -p /app/data /app/userbot-session
chown -R node:node /app/data /app/userbot-session
exec su-exec node "$@"
