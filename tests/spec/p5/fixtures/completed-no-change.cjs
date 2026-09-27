const fs = require("node:fs");
const args = process.argv.slice(2);
const value = JSON.stringify({
  kind: "completed",
  message: "The existing candidate already satisfies the request.",
});
const outputFlag = args.findIndex(
  (arg) => arg === "--output-last-message" || arg === "-o",
);
if (outputFlag >= 0) {
  fs.writeFileSync(args[outputFlag + 1], value);
}
process.stdout.write(
  JSON.stringify({ type: "thread.started", thread_id: "no-change-fixture" }) +
    "\n",
);
process.stdout.write(
  JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: value },
  }) + "\n",
);
process.stdout.write(
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
  }) + "\n",
);
