// A persisted GitHub API transport double. It supplies API authors, never product decisions.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const [root, ...args] = process.argv.slice(2);
const file = path.join(root, 'github.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const value = names => { const i = args.findIndex(a => names.includes(a)); return i < 0 ? undefined : args[i + 1]; };
const method = value(['--method', '-X']) || 'GET';
const endpoint = args.find(a => a === 'user' || a.startsWith('repos/'));
let facts = [];
try { const db = new DatabaseSync(path.join(root, 'store/run.sqlite'), {readOnly:true}); facts = db.prepare('SELECT json FROM events ORDER BY sequence').all().map(r => JSON.parse(r.json).fact); db.close(); } catch {}
data.calls.push({args, method, endpoint, facts});
const save = () => fs.writeFileSync(file, JSON.stringify(data));
const fail = (message, code = 1) => { save(); process.stderr.write(message); process.stdout.write(JSON.stringify({message,status:'503'})); process.exit(code); };
if (args[0] !== 'api') fail('Only structured gh api is supported');
if (data.mode === 'api-failure') fail('Injected gateway failure');
if (data.mode === 'malformed') { save(); process.stdout.write('{bad-json'); process.exit(0); }
let result;
if (endpoint === 'user' && method === 'GET') result = data.publisher;
else if (endpoint?.split('?')[0] === 'repos/factory-fixture/decisions/issues/7' && method === 'GET') result = {number:7,html_url:'https://github.com/factory-fixture/decisions/issues/7'};
else if (endpoint?.split('?')[0] === 'repos/factory-fixture/decisions/issues/7/comments') {
  if (method === 'GET') {
    if (!args.includes('--paginate') || !args.includes('--slurp')) fail('Complete paginated comment snapshots require --paginate --slurp');
    result = data.comments.length ? data.comments.map(c => [c]) : [[]];
  } else if (method === 'POST') {
    if (value(['--input']) !== '-') fail('POST body must use JSON stdin');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (typeof input.body !== 'string' || Object.keys(input).length !== 1) fail('Invalid POST body');
    const id = data.nextId++;
    result = {id,html_url:`https://github.com/factory-fixture/decisions/issues/7#issuecomment-${id}`,user:data.publisher,body:input.body,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    data.comments.push(result);
    if (data.mode === 'post-response-lost') fail('Injected response loss after durable remote creation');
    if (data.mode === 'post-absent') { data.comments.pop(); fail('Injected uncertain POST without observed result'); }
  } else fail('Unsupported mutation');
} else fail(`Unexpected endpoint ${endpoint}`);
save(); process.stdout.write(JSON.stringify(result));
