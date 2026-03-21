# TD: Narrow voice command regex patterns

## Problem
The "stop" command regex in index.ts matches the bare word "stop", which is very common in conversation. Someone saying "stop talking about that" triggers the unfollow command. Similarly, "follow" alone triggers "follow me" rather than showing an error.

## Suggested Fix
Consider requiring at least two words for ambiguous commands (e.g. "stop following" but not bare "stop"), or add a confirmation step for single-word commands.

## File
index.ts lines 8-12

## Priority
Low
