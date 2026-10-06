#!/bin/bash
# usage: test/run.sh [env assignments...]   restarts the local server and runs the browser test
cd /home/claude/munshi
[ -f test/pid ] && kill "$(cat test/pid)" 2>/dev/null
sleep 0.4; rm -rf .data
env "$@" nohup node test/server.mjs > test/server.log 2>&1 &
echo $! > test/pid
sleep 1.5
node test/e2e.mjs 2>&1 | tail -40
tail -4 test/server.log
