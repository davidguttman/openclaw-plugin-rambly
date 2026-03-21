# TD: Add test harness and unit test coverage

## Problem
The project has zero tests and no test framework. There are no test scripts in package.json.

## Impact
No regression protection. Bugs found in this review could easily be reintroduced.

## Suggested Approach
1. Add vitest as dev dependency
2. Add test script to package.json
3. Create test files for each module:
   - daemon.test.ts: spawn lifecycle, send/kill, event emission, timeout behavior
   - manager.test.ts: join/leave lifecycle, event handling, follow mode, transcript filtering, hearing radius
   - core-bridge.test.ts: package root resolution, caching, poisoned cache recovery
   - response-generator.test.ts: happy path, error paths, session reuse, payload filtering
   - index.test.ts: voice command regex matching, command routing, queue processing, tool parameter validation

## Priority
High
