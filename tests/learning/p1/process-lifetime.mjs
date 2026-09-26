// Isolated Win32/Node learning probe, excluded from product acceptance tests.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'swf-p1-process-'));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function setup(name){
 const log=join(root,name+'.json'); const grand=join(root,name+'-grand.cjs');const child=join(root,name+'-child.cjs');
 writeFileSync(grand,`require('fs').writeFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
 writeFileSync(child,`const c=require('child_process').spawn(process.execPath,[${JSON.stringify(grand)}],{detached:true,windowsHide:true,stdio:'ignore'}); c.unref();`);
 return {log,child};
}
const plain=await setup('taskkill');
const parent=spawn(process.execPath,[plain.child],{windowsHide:true,stdio:'ignore'});
await new Promise(r=>parent.on('exit',r));await new Promise(r=>setTimeout(r,400));
const plainPid=JSON.parse(readFileSync(plain.log,'utf8')).pid;
const kill=spawnSync('taskkill',['/PID',String(parent.pid),'/T','/F'],{encoding:'utf8',windowsHide:true});
const survivor=alive(plainPid);
if(survivor) process.kill(plainPid); // exact PID recorded by this owned disposable child only.
const job=await setup('job');
const run=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-File',resolve('tests/learning/p1/job-probe.ps1'),'-NodeExe',process.execPath,'-ChildScript',job.child],{encoding:'utf8',windowsHide:true,timeout:15000});
await new Promise(r=>setTimeout(r,200));
const jobPid=JSON.parse(readFileSync(job.log,'utf8')).pid;
const jobSurvivor=alive(jobPid);if(jobSurvivor) process.kill(jobPid);
const result={root,node:process.version,taskkill:{status:kill.status,parentPid:parent.pid,grandchildPid:plainPid,grandchildSurvived:survivor,stderr:kill.stderr},job:{status:run.status,grandchildPid:jobPid,grandchildSurvived:jobSurvivor,stdout:run.stdout,stderr:run.stderr}};
writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
process.exitCode=survivor && !jobSurvivor && run.status===0 ? 0:1;
