const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const expected = require('./helper.cjs');
const [mode, fixtureRoot] = process.argv.slice(2);
process.stdout.write('verifier-started\n');
process.stderr.write('verifier-stderr\n');
if(mode==='hang') setInterval(()=>{},1000);
else if(mode==='nonzero') process.exit(7);
else {
  const observed = require(path.join(process.cwd(),'src','answer.cjs'));
  if(observed!==expected) {process.stderr.write(`Expected ${expected}; observed ${observed}\n`);process.exit(1);}
  if(mode==='mutate') fs.writeFileSync(path.join(process.cwd(),'src','answer.cjs'),'module.exports = 99;\n');
  if(mode==='restrictions') {
    const report={};
    for(const [name,target] of [['bundle',path.join(fixtureRoot,'trusted','helper.cjs')],['artifact',path.join(fixtureRoot,'external.txt')],['source',path.join(fixtureRoot,'repo','src','answer.cjs')]]) {
      try {fs.writeFileSync(target,'BREACH');report[name]='wrote';}catch(error){report[name]=error.code;}
    }
    try {fs.readFileSync(path.join(fixtureRoot,'credentials.txt'));report.credentials='read';}catch(error){report.credentials=error.code;}
    console.log('restriction-report:'+JSON.stringify(report));
  }
  if(mode==='detached') {
    const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    child.unref();
    console.log('child-pid:'+child.pid);
  }
  process.stdout.write(`verified:${observed}\n`);
}
