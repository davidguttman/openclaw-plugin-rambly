# TD: Add size limit to transcript queue in index.ts

## Problem
The transcriptQueue in index.ts (line 50) has no upper bound. If agent responses are slow (30s timeout) and many people are talking, the queue grows unboundedly. Each item waits for a full agent response before the next is processed.

## Suggested Fix
Add a max queue size (e.g. 20 items) with oldest-item eviction when the limit is reached.

## File
index.ts line 50, 164

## Priority
Low
