const fs = require("node:fs");
const path = require("node:path");
const [root, ...args] = process.argv.slice(2);
const flag = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const cwd = flag("-C") || flag("--cd") || process.cwd();
fs.writeFileSync(path.join(cwd, "src/run.sh"), "#!/bin/sh\necho repaired\n");
fs.unlinkSync(path.join(cwd, "src/delete-me.txt"));
fs.writeFileSync(path.join(cwd, "src/new file.txt"), "new regular file\n");
const target = path.join(root, "trusted", "p2-worker.cjs");
process.argv = [process.execPath, target, "good", root, ...args];
require(target);
