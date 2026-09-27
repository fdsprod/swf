const path = require("node:path");
const crypto = require("node:crypto");
const [mode, root] = process.argv.slice(2);
console.log("p2-verifier-invocation:" + crypto.randomUUID());
console.log(
  "p2-factory-fault-inherited:" + Object.hasOwn(process.env, "SWF_TEST_FAULT"),
);
const target = path.join(root, "trusted", "verifier.cjs");
if (mode === "active-tree") {
  const observed = require(path.join(process.cwd(), "src", "answer.cjs"));
  if (observed !== 42) {
    throw new Error(`Expected 42; observed ${observed}`);
  }
  const child = require("node:child_process").spawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  console.log("p2-active-verifier:" + process.pid);
  setInterval(() => {}, 1000);
} else {
  process.argv = [process.execPath, target, mode, root];
  require(target);
}
