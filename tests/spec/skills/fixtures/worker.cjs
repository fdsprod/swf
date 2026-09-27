const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [mode,...args]=process.argv.slice(2),flag=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined;
const cwd=flag('-C')||flag('--cd')||process.cwd();
const raw=args.at(-1)==='-'?fs.readFileSync(0,'utf8'):args.at(-1);
let input;try{input=JSON.parse(raw);}catch{input=null;}
const instructions=input?.context?.instructions??input?.instructions;
const files=[...(instructions?.skills||[]).flatMap(s=>[s.entrypoint,...s.assets]),...(instructions?.assignment?.design?.kind==='provided'?[instructions.assignment.design.artifact]:[])];
const observations=files.map(a=>{const row={path:a.path};try{row.base64=fs.readFileSync(a.path).toString('base64');}catch(e){row.readError=e.code;}try{const fd=fs.openSync(a.path,'r+');fs.closeSync(fd);row.write='opened';}catch(e){row.write=e.code;}return row;});
fs.appendFileSync(path.join(cwd,'src/skills-contexts.jsonl'),JSON.stringify({pid:process.pid,threadId:crypto.randomUUID(),input,raw,observations})+'\n');
if(mode==='decision'||mode==='repair'){
  const name=mode==='decision'?'p3-codex-double.cjs':'p4-codex-double.cjs';
  const forwarded=[...args];if(forwarded.at(-1)==='-')forwarded[forwarded.length-1]=raw;
  process.argv=[process.execPath,path.join(__dirname,name),mode==='decision'?'decision':'fail-first',...forwarded];
  require(path.join(__dirname,name));
}else{
  fs.writeFileSync(path.join(cwd,'src/answer.cjs'),'module.exports = 42;\n');
  const outcome={kind:'completed',message:'Candidate ready for external checks.'};
  process.stdout.write(JSON.stringify({type:'thread.started',thread_id:crypto.randomUUID()})+'\n');
  process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(outcome)}})+'\n');
  process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}})+'\n');
}
