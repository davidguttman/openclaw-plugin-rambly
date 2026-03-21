# TD: Return structured results from manager methods instead of strings

## Problem
All RamblyManager public methods (join, leave, speak, move, follow, unfollow, status) return Promise<string>. Callers in index.ts use string matching (e.g. result.startsWith("Now following")) to determine success/failure. This is brittle—if return strings change, behavior silently degrades.

## Impact
- Fragile control flow in voice command handling (index.ts lines 64, 76, 87-88)
- Cannot programmatically distinguish success from error without parsing strings
- Makes testing harder

## Suggested Fix
Return `{ success: boolean; message: string; data?: unknown }` from all public methods. Update callers to check `.success` instead of string matching.

## File
src/manager.ts, index.ts

## Priority
Medium
