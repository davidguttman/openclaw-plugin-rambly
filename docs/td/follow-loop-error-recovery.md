# TD: Add error recovery to follow loop

## Problem
The follow loop runs at 100ms intervals and calls daemon.send() without try/catch. If the daemon dies mid-follow, send() throws on every tick of the interval, potentially crashing the process with uncaught exceptions in setInterval.

Also, breadcrumb recording is duplicated between peer_moved event handler and the follow loop interval.

## Suggested Fix
1. Wrap the follow loop body in try/catch, stopping follow on error
2. Consolidate breadcrumb recording to only the peer_moved event handler (reactive) and remove the duplicate from the follow loop

## File
src/manager.ts lines 297-350 (follow loop), lines 64-75 (peer_moved breadcrumbs)

## Priority
High - can crash the process
