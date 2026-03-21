# TD: Add runtime validation for daemon events

## Problem
In daemon.ts, JSON.parse(line) output is cast directly to DaemonEvent with no validation. Malformed or unexpected events from the child process flow through the system with wrong/missing fields. The daemon is an external process so its output cannot be trusted.

## Suggested Fix
Add a lightweight runtime check on the `event` field after JSON.parse, before emitting. At minimum, verify that `event.event` is a known string. Consider a small validation function for required fields per event type.

## File
src/daemon.ts line 37, src/types.ts

## Priority
Medium
