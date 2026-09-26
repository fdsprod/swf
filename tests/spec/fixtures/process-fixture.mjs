// Harness-only process. This is never the product candidate.
process.stdout.write(`${process.argv[2]}\n`);
process.exitCode = Number(process.argv[3] ?? 0);
