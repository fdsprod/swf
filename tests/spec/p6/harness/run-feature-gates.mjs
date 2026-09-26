import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {candidateRoot,trustedRoot,hash} from './support.mjs';
const files=directory=>existsSync(directory)?readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]):[];
const manifest=(root,paths)=>Object.fromEntries(paths.sort().map(path=>[relative(root,path).replaceAll('\\','/'),hash(readFileSync(path))]));
const bundle=()=>manifest(trustedRoot,[...files(join(trustedRoot,'tests/spec')),...files(join(trustedRoot,'src/contracts')),...['package.json','package-lock.json','tsconfig.json'].map(p=>join(trustedRoot,p))]);
const source=()=>manifest(candidateRoot,files(join(candidateRoot,'src')));
const beforeBundle=bundle(),beforeSource=source(),proof=resolve(process.env.P6_PROOF_DIR||join(trustedRoot,'.p6-proof','inspect-latest'));
mkdirSync(proof,{recursive:true});writeFileSync(join(proof,'bundle-manifest.json'),JSON.stringify(beforeBundle,null,2)+'\n');
const results=[];
function execute(name,args,{tests=false,timeout=120000}={}){
  const start=Date.now(),p=spawnSync(process.execPath,args,{cwd:candidateRoot,env:{...process.env,FACTORY_CANDIDATE_ROOT:candidateRoot},encoding:'utf8',windowsHide:true,timeout,maxBuffer:32*1024*1024});
  const log=(p.stdout||'')+(p.stderr||'')+(p.error?'\n'+p.error.stack:'');const logPath=join(proof,name+'.log');writeFileSync(logPath,log);
  const summary=Object.fromEntries([...log.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm)].map(m=>[m[1],Number(m[2])]));
  const incomplete=tests&&(!(summary.tests>0)||['pass','fail','cancelled','skipped','todo'].some(k=>summary[k]===undefined)||summary.pass!==summary.tests||summary.fail!==0||summary.cancelled!==0||summary.skipped!==0||summary.todo!==0);
  const exitCode=p.status===0&&!incomplete?0:p.status||1;
  results.push({name,command:[process.execPath,...args],exitCode,processExitCode:p.status,signal:p.signal,elapsedMs:Date.now()-start,summary,incomplete:Boolean(incomplete),logPath});process.stdout.write(`${name}: exit ${exitCode}${tests?`; tests ${summary.tests}, pass ${summary.pass}, fail ${summary.fail}, skipped ${summary.skipped}`:''}\n`);
}
execute('typecheck',[join(trustedRoot,'node_modules/typescript/bin/tsc'),'--project',join(candidateRoot,'tsconfig.json'),'--noEmit']);
execute('build',[join(trustedRoot,'node_modules/typescript/bin/tsc'),'--project',join(candidateRoot,'tsconfig.json')]);
execute('inspect-sanity',['--test','--test-reporter=tap',join(trustedRoot,'tests/spec/p6/harness/sanity.test.mjs')],{tests:true});
execute('inspect-acceptance',['--test','--test-reporter=tap','--test-concurrency=1',join(trustedRoot,'tests/spec/p6/scenarios/inspect.test.mjs')],{tests:true,timeout:1200000});
const afterBundle=bundle(),afterSource=source();const changes=(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])].filter(path=>a[path]!==b[path]);
const bundleChanges=changes(beforeBundle,afterBundle),sourceChanges=changes(beforeSource,afterSource);
results.push({name:'frozen-bundle-after',exitCode:bundleChanges.length?1:0,differences:bundleChanges},{name:'candidate-source-stability',exitCode:sourceChanges.length?1:0,differences:sourceChanges});
const git=(root,args)=>{const p=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});return p.status===0?p.stdout.trim():null;};
const report={phase:'P6-inspect',purpose:'focused-feature-validation',accepted:false,featureChecksPassed:results.every(r=>r.exitCode===0),selfHostingProof:'separate required gate; not evaluated here',trustedRoot,candidateRoot,trustedRevision:git(trustedRoot,['rev-parse','HEAD']),candidateRevision:git(candidateRoot,['rev-parse','HEAD']),candidateChanges:git(candidateRoot,['status','--porcelain','--untracked-files=all']),nodeVersion:process.version,bundleDigest:hash(JSON.stringify(beforeBundle)),candidateSourceDigestBefore:hash(JSON.stringify(beforeSource)),candidateSourceDigestAfter:hash(JSON.stringify(afterSource)),results};
writeFileSync(join(proof,'report.json'),JSON.stringify(report,null,2)+'\n');process.stdout.write('Proof: '+proof+'\n');process.exitCode=results.some(r=>r.exitCode!==0)?1:0;
