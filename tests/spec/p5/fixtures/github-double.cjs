const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const [root, ...args] = process.argv.slice(2);
const file = path.join(root, "github.json");
const d = JSON.parse(fs.readFileSync(file, "utf8"));
const value = (names) => {
  const i = args.findIndex((a) => names.includes(a));
  return i < 0 ? undefined : args[i + 1];
};
const method = value(["--method", "-X"]) || "GET";
const endpoint = args.find((a) => a === "user" || a.startsWith("repos/"));
const hostname = value(["--hostname"]);
let facts = [];
try {
  const db = new DatabaseSync(path.join(root, "store/run.sqlite"), {
    readOnly: true,
  });
  facts = db
    .prepare("SELECT json FROM events ORDER BY sequence")
    .all()
    .map((r) => JSON.parse(r.json).fact);
  db.close();
} catch {}
d.calls.push({ args, method, endpoint, hostname, facts });
const save = () => fs.writeFileSync(file, JSON.stringify(d));
const fail = (message) => {
  save();
  process.stderr.write(message);
  process.stdout.write(JSON.stringify({ message }));
  process.exit(1);
};
if (args[0] !== "api" || hostname !== "github.com") {
  fail("Explicit structured github.com API required");
}
if (d.mode === "api-error") {
  fail("Injected API failure");
}
if (d.mode === "malformed") {
  save();
  process.stdout.write("{malformed");
  process.exit(0);
}
const resource = endpoint?.split("?")[0];
const prefix = "repos/factory-fixture/delivery";
let result;
const pages = (items) => (items.length ? items.map((item) => [item]) : [[]]);
const paginated = () => {
  if (!args.includes("--paginate") || !args.includes("--slurp")) {
    fail("Full pagination required");
  }
};
const body = () => {
  if (value(["--input"]) !== "-") {
    fail("Mutation requires JSON stdin");
  }
  return JSON.parse(fs.readFileSync(0, "utf8"));
};
if (endpoint === "user" && method === "GET") {
  result = d.publisher;
} else if (resource === prefix && method === "GET") {
  result = d.repository;
} else if (resource === prefix + "/issues/7" && method === "GET") {
  result = d.issue;
} else if (
  resource === prefix + "/branches/" + d.base.name &&
  method === "GET"
) {
  result = d.base;
} else if (resource === prefix + "/issues/7/comments") {
  if (method === "GET") {
    paginated();
    result = pages(d.comments);
  } else if (method === "POST") {
    const input = body();
    const id = d.nextId++;
    const date = new Date().toISOString();
    result = {
      id,
      html_url: d.issue.html_url + "#issuecomment-" + id,
      user: d.publisher,
      body: input.body,
      created_at: date,
      updated_at: date,
    };
    d.comments.push(result);
  } else {
    fail("Unsupported comment action");
  }
} else if (resource === prefix + "/pulls") {
  if (method === "GET") {
    paginated();
    if (!endpoint.includes("state=all")) {
      fail("PR reconciliation must include all states");
    }
    result = pages(d.pulls);
  } else if (method === "POST") {
    const input = body();
    if (Object.keys(input).sort().join(",") !== "base,body,head,title") {
      fail("Exact PR request shape required");
    }
    const branch = input.head.includes(":")
      ? input.head.split(":").at(-1)
      : input.head;
    const remote = cp.spawnSync(
      d.git,
      ["ls-remote", "--exit-code", d.remote, "refs/heads/" + branch],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    if (remote.status !== 0) {
      fail("PR attempted before exact branch exists");
    }
    const sha = remote.stdout.trim().split(/\s+/)[0];
    if (
      !facts.some((f) => f.type === "PushConfirmed" && f.receipt.sha === sha)
    ) {
      fail("PR attempted before durable push receipt");
    }
    const id = d.nextId++;
    const number = d.pulls.length + 1;
    result = {
      id,
      number,
      html_url: d.repository.html_url + "/pull/" + number,
      url: "https://api.github.com/" + prefix + "/pulls/" + number,
      user: d.publisher,
      title: input.title,
      body: input.body,
      state: "open",
      merged: false,
      merged_at: null,
      merge_commit_sha: null,
      head: { ref: branch, sha, repo: d.repository },
      base: { ref: input.base, sha: d.base.commit.sha, repo: d.repository },
    };
    d.pulls.push(result);
    if (d.mode === "pr-absent") {
      d.pulls.pop();
      fail("Unknown POST outcome with absent result");
    }
    if (d.mode === "pr-response-lost") {
      fail("POST completed but response lost");
    }
  } else {
    fail("No PR update or merge is permitted");
  }
} else if (resource?.startsWith(prefix + "/pulls/") && method === "GET") {
  result = d.pulls.find((p) => p.number === Number(resource.split("/").at(-1)));
  if (!result) {
    fail("Unknown PR");
  }
} else if (
  resource?.startsWith(prefix + "/commits/") &&
  resource.endsWith("/check-runs") &&
  method === "GET"
) {
  paginated();
  if (!endpoint.includes("filter=all")) {
    fail("CI must observe all attempts");
  }
  if (d.checkMode === "api-error") {
    fail("Injected CI read failure");
  }
  if (d.checkMode === "malformed") {
    save();
    process.stdout.write("{malformed");
    process.exit(0);
  }
  const sha = resource.split("/").at(-2);
  const normal = {
    id: 2001,
    name: "required-build",
    head_sha: sha,
    app: { id: 301, slug: "fixture-ci" },
    status: "completed",
    conclusion: "success",
    started_at: "2026-09-26T01:00:00Z",
    completed_at: "2026-09-26T01:01:00Z",
  };
  let checks = [normal];
  if (d.checkMode === "missing") {
    checks = [];
  }
  if (d.checkMode === "pending") {
    checks = [{ ...normal, status: "in_progress", conclusion: null }];
  }
  if (d.checkMode === "failed") {
    checks = [{ ...normal, conclusion: "failure" }];
  }
  if (d.checkMode === "skipped") {
    checks = [{ ...normal, conclusion: "skipped" }];
  }
  if (d.checkMode === "wrong-head") {
    checks = [{ ...normal, head_sha: "a".repeat(40) }];
  }
  if (d.checkMode === "wrong-app") {
    checks = [{ ...normal, app: { id: 999 } }];
  }
  if (d.checkMode === "wrong-name") {
    checks = [{ ...normal, name: "lookalike-build" }];
  }
  if (d.checkMode === "repeated") {
    checks = [normal, { ...normal, id: 3, status: "queued", conclusion: null }];
  }
  if (d.checkMode === "multiple-success") {
    checks = [normal, { ...normal, id: 2002 }];
  }
  if (d.checkMode === "paged") {
    checks = [
      { ...normal, id: 2, name: "unrequired", app: { id: 999 } },
      normal,
    ];
  }
  if (d.checkMode === "head-changed") {
    d.pulls[0].head.sha = "b".repeat(40);
  }
  if (d.checkMode === "closed-during-read") {
    d.pulls[0].state = "closed";
  }
  if (d.checkMode === "mixed-pending") {
    checks = [
      normal,
      {
        ...normal,
        id: 2002,
        name: "required-lint",
        app: { id: 302 },
        status: "queued",
        conclusion: null,
      },
    ];
  }
  result = checks.length
    ? checks.map((c) => ({ total_count: checks.length, check_runs: [c] }))
    : [{ total_count: 0, check_runs: [] }];
} else {
  fail("Unexpected API request " + endpoint);
}
save();
process.stdout.write(JSON.stringify(result));
