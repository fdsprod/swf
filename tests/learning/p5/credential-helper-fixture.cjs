// Learning fixture. Only known dummy credentials enter this program.
const fs = require("node:fs");
const path = require("node:path");
const [root, label, operation] = process.argv.slice(2);
const config = JSON.parse(
  fs.readFileSync(path.join(root, "helper.json"), "utf8"),
);
const fields = Object.fromEntries(
  fs
    .readFileSync(0, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const known = !fields.password || fields.password === config.password;
fs.appendFileSync(
  path.join(root, "helper-calls.jsonl"),
  JSON.stringify({
    label,
    operation,
    protocol: fields.protocol,
    host: fields.host,
    path: fields.path,
    hasPassword: !!fields.password,
    knownDummyPassword: known,
  }) + "\n",
);
if (!known) {
  process.exit(9);
}
if (operation === "get") {
  if (fields.protocol !== config.protocol || fields.host !== config.host) {
    process.stdout.write("quit=true\n\n");
    process.exit(0);
  }
  process.stdout.write(
    `username=fixture-user\npassword=${config.password}\n\n`,
  );
}
// store/erase are observed but deliberately persist no password.
