#!/usr/bin/env bun
import { run } from "./src/cli";

export async function main(argv = process.argv) {
  await run(argv);
}

if (import.meta.main) {
  await main();
}
