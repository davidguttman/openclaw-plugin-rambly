# TD: Fix status() race condition with 300ms sleep

## Problem
manager.status() sends a "status" command to the daemon then waits 300ms hoping the response arrives before reading state. This is a race condition—on slow machines or under load, stale data is returned.

## Suggested Fix
Use a promise that resolves when the "status" event is received from the daemon, with a timeout fallback.

## File
src/manager.ts line 249-251

## Priority
Medium
