import { execSync } from "node:child_process";

interface TestResult {
  name: string;
  status: "passed" | "failed";
}

interface VitestJsonOutput {
  testResults?: Array<{
    assertionResults?: Array<{
      ancestorTitles?: string[];
      title?: string;
      status?: string;
      fullName?: string;
    }>;
  }>;
}

function runTests(): TestResult[] {
  let output: string;
  try {
    output = execSync("npx vitest run --reporter=json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: any) {
    output = err.stdout;
    if (!output) output = String();
  }

  const jsonMatch = output.match(/{[\s\S]*}/);
  if (!jsonMatch) return [];

  let parsed: VitestJsonOutput;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  const results: TestResult[] = [];
  for (const suite of parsed.testResults ?? []) {
    for (const test of suite.assertionResults ?? []) {
      const name = test.fullName || [
        ...(test.ancestorTitles ?? []),
        test.title ?? "unknown",
      ].join(" > ");
      results.push({
        name,
        status: test.status === "passed" ? "passed" : "failed",
      });
    }
  }
  return results;
}

function main() {
  const runs = parseInt(process.argv[2] || "5", 10);
  const report: Record<string, { passed: number; failed: number; flaky: boolean }> = {};
  const allTestNames = new Set<string>();

  console.error("Running test suite " + runs + " times to detect flaky tests...");

  for (let i = 0; i < runs; i++) {
    console.error("  Run " + (i + 1) + "/" + runs + "...");
    const results = runTests();

    for (const r of results) {
      allTestNames.add(r.name);
      if (!report[r.name]) {
        report[r.name] = { passed: 0, failed: 0, flaky: false };
      }
      if (r.status === "passed") {
        report[r.name]!.passed++;
      } else {
        report[r.name]!.failed++;
      }
    }
  }

  const flakyTests: string[] = [];
  const stableTests: string[] = [];

  for (const name of allTestNames) {
    const entry = report[name]!;
    if (entry.passed > 0 && entry.failed > 0) {
      entry.flaky = true;
      flakyTests.push(name);
    } else {
      stableTests.push(name);
    }
  }

  const output = { runs, totalTests: allTestNames.size, flakyTests, stableTests, report };
  console.log(JSON.stringify(output, null, 2));

  if (flakyTests.length > 0) {
    console.error("Found " + flakyTests.length + " flaky test(s):");
    for (const name of flakyTests) {
      const entry = report[name]!;
      console.error("  - " + name + " (passed: " + entry.passed + ", failed: " + entry.failed + ")");
    }
  } else {
    console.error("No flaky tests detected across " + runs + " runs.");
  }
}

main();