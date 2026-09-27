import { writeFileSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
const hook = JSON.parse(process.env.SWF_TEST_FAULT);
if (process.env.P2_SANITY_CHILD_EXE) {
  const child = spawn(
    process.env.P2_SANITY_CHILD_EXE,
    ["-e", "setInterval(()=>{},1000)"],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
}
writeFileSync(
  hook.marker + ".tmp",
  JSON.stringify({
    point: hook.point,
    runId: "sanity-run",
    ...(hook.eventType ? { eventType: hook.eventType } : {}),
  }),
);
renameSync(hook.marker + ".tmp", hook.marker);
setInterval(() => {}, 1000);
