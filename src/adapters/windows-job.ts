import { execFileSync, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessRecord, ProcessTermination } from "../contracts/local.js";
import type { ProcessIdentity } from "../contracts/durable.js";
import { artifact, hash } from "./local-files.js";

// The helper owns the Job handle. The owner handle binds it to the factory lifetime.
const helper = String.raw`param([string]$Config)
$ErrorActionPreference = 'Stop'
$c = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
public static class FactoryJob {
 [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC basic; public IO io; public UIntPtr pm,jm,ppm,pjm; }
 [StructLayout(LayoutKind.Sequential)] struct ACCOUNT { public long a,b,c,d; public uint faults,total,active,terminated; }
 [StructLayout(LayoutKind.Sequential)] struct SECURITY { public uint length; public IntPtr descriptor; public int inherit; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUP { public uint cb; public string reserved,desktop,title; public uint x,y,xs,ys,xc,yc,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process,thread; public uint pid,tid; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attrs,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int klass,ref EXT info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int klass,out ACCOUNT info,uint size,IntPtr returned);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUP si,out PROCESS pi);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder path,ref uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint share,ref SECURITY sa,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
 static string Identity(System.Diagnostics.Process p) { IntPtr h=OpenProcess(0x1000,false,(uint)p.Id);Check(h!=IntPtr.Zero);try{var path=new StringBuilder(32768);uint size=32768;Check(QueryFullProcessImageNameW(h,0,path,ref size));return "{\"pid\":"+p.Id+",\"createdAt\":\""+p.StartTime.ToUniversalTime().ToString("o")+"\",\"executable\":\""+path.ToString().Replace("\\","\\\\").Replace("\"","\\\"")+"\"}";}finally{CloseHandle(h);} }
 static void Publish(string path,string text) { File.WriteAllText(path+".tmp",text); File.Move(path+".tmp",path); }
 public static string Run(string exe,string command,string cwd,string input,string output,string error,string cancel,string startedPath,string supervisor,string jobName,uint owner,string ownerCreatedAt,int timeout) {
  IntPtr job=IntPtr.Zero,ownerHandle=IntPtr.Zero,hin=IntPtr.Zero,hout=IntPtr.Zero,herr=IntPtr.Zero; PROCESS pi=new PROCESS();
  try {
   Publish(supervisor,Identity(System.Diagnostics.Process.GetCurrentProcess()));
   ownerHandle=OpenProcess(0x101000,false,owner); Check(ownerHandle!=IntPtr.Zero); Check(WaitForSingleObject(ownerHandle,0)==258);
   long created,exited,kernel,user;Check(GetProcessTimes(ownerHandle,out created,out exited,out kernel,out user));if(DateTime.FromFileTimeUtc(created).ToString("o")!=ownerCreatedAt)throw new Exception("Factory process identity changed");
   job=CreateJobObjectW(IntPtr.Zero,jobName); Check(job!=IntPtr.Zero); var info=new EXT();info.basic.flags=0x2000;Check(SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(info)));
   var sa=new SECURITY();sa.length=(uint)Marshal.SizeOf(sa);sa.inherit=1;
   hin=CreateFileW(input,0x80000000,3,ref sa,3,0,IntPtr.Zero);Check(hin!=new IntPtr(-1));
   hout=CreateFileW(output,0x40000000,3,ref sa,2,0,IntPtr.Zero);Check(hout!=new IntPtr(-1));
   herr=CreateFileW(error,0x40000000,3,ref sa,2,0,IntPtr.Zero);Check(herr!=new IntPtr(-1));
   var si=new STARTUP();si.cb=(uint)Marshal.SizeOf(si);si.flags=0x100;si.input=hin;si.output=hout;si.error=herr;
   Check(CreateProcessW(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x4|0x08000000,IntPtr.Zero,cwd,ref si,out pi));
   if(!AssignProcessToJobObject(job,pi.process)){TerminateProcess(pi.process,1);Check(false);}
   Publish(startedPath,Identity(System.Diagnostics.Process.GetProcessById((int)pi.pid)));
   Check(WaitForSingleObject(ownerHandle,0)==258);
   Check(ResumeThread(pi.thread)!=0xffffffff);
   var started=DateTime.UtcNow;string result=null;
   while(WaitForSingleObject(pi.process,25)==258) {
    if(WaitForSingleObject(ownerHandle,0)!=258 || File.Exists(cancel)){result="cancelled";break;}
    if((DateTime.UtcNow-started).TotalMilliseconds>=timeout){result="timeout";break;}
    if(new FileInfo(output).Length>8388608 || new FileInfo(error).Length>8388608){result="output_limit";break;}
   }
   uint code;Check(GetExitCodeProcess(pi.process,out code));
   if(new FileInfo(output).Length>8388608 || new FileInfo(error).Length>8388608)result="output_limit";
   Check(TerminateJobObject(job,1));
   var stopped=DateTime.UtcNow;
   while(true){ACCOUNT count;Check(QueryInformationJobObject(job,1,out count,(uint)Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero));if(count.active==0)break;if((DateTime.UtcNow-stopped).TotalSeconds>10)throw new Exception("Owned processes did not stop");Thread.Sleep(20);}
   return result??("exited:"+code);
  } finally { foreach(var h in new[]{pi.thread,pi.process,hin,hout,herr,job,ownerHandle}) if(h!=IntPtr.Zero && h!=new IntPtr(-1))CloseHandle(h); }
 }
}
'@
try {
 $result = [FactoryJob]::Run($c.executable,$c.command,$c.cwd,$c.input,$c.output,$c.error,$c.cancel,$c.started,$c.supervisor,$c.jobName,[uint32]$c.owner,$c.ownerCreatedAt,[int]$c.timeout)
 [IO.File]::WriteAllText($c.result,$result)
} catch { [IO.File]::WriteAllText($c.result,'launch_error:' + $_.Exception.ToString()); exit 1 }
`;

// Windows CreateProcess command-line quoting, without a shell.
function quote(value: string): string { return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`; }
const jobName = (stem: string): string => `Local\\SWF-${hash(stem.toLowerCase())}`;
let ownerCreatedAt: string | undefined;
function ownerCreation(): string {
  ownerCreatedAt ??= execFileSync(join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", `[Diagnostics.Process]::GetProcessById(${process.pid}).StartTime.ToUniversalTime().ToString('o')`], { encoding: "utf8", windowsHide: true, timeout: 10000, env: cleanEnvironment() }).trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(ownerCreatedAt)) throw new Error("Cannot observe factory process creation identity");
  return ownerCreatedAt;
}
export function jobIsStopped(stem: string): boolean {
  const script = `Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class JobRecovery {
 [StructLayout(LayoutKind.Sequential)] struct ACCOUNT { public long a,b,c,d; public uint faults,total,active,terminated; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access,bool inherit,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int klass,out ACCOUNT info,uint size,IntPtr returned);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static bool Empty(string name) {var job=OpenJobObjectW(4,false,name);if(job==IntPtr.Zero){int error=Marshal.GetLastWin32Error();if(error==2)return true;throw new System.ComponentModel.Win32Exception(error);}try{ACCOUNT count;if(!QueryInformationJobObject(job,1,out count,(uint)Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return count.active==0;}finally{CloseHandle(job);}}
}
'@
[JobRecovery]::Empty('${jobName(stem)}')`;
  const result = execFileSync(join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 10000, env: cleanEnvironment() }).trim();
  if (result !== "True" && result !== "False") throw new Error("Cannot inspect owned Windows Job");
  return result === "True";
}
export function cleanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/(TOKEN|SECRET|PASSWORD|API_KEY|ASKPASS|SSH_AUTH|GIT_CONFIG|NODE_OPTIONS|NODE_PATH)/i.test(key) || key.toUpperCase() === "SWF_TEST_FAULT") delete env[key];
  return env;
}
export async function processInJob(options: { executable: string; args: string[]; cwd: string; directory: string; name: string; timeoutSeconds: number; input?: string; trustedGitHub?: boolean; signal?: AbortSignal; onStarted?: (identity: ProcessIdentity) => Promise<void> }): Promise<ProcessRecord> {
  const { executable, args, cwd, directory, name } = options;
  const stem = join(directory, name);
  const stdout = `${stem}.stdout`, stderr = `${stem}.stderr`, resultPath = `${stem}.termination`, cancel = `${stem}.cancel`;
  await Promise.all([writeFile(stdout, ""), writeFile(stderr, ""), writeFile(`${stem}.stdin`, options.input ?? ""), writeFile(`${stem}.ps1`, helper)]);
  await writeFile(`${stem}.json`, JSON.stringify({ executable, command: [executable, ...args].map(quote).join(" "), cwd, input: `${stem}.stdin`, output: stdout, error: stderr, result: resultPath, cancel, started: `${stem}.started.json`, supervisor: `${stem}.supervisor.json`, jobName: jobName(stem), owner: process.pid, ownerCreatedAt: ownerCreation(), timeout: options.timeoutSeconds * 1000 }));
  const abort = (): void => { void writeFile(cancel, "cancelled"); };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) await writeFile(cancel, "cancelled");
  let termination: ProcessTermination;
  let completed: Promise<string> | undefined;
  let stopSupervisor: (() => void) | undefined;
  try {
    let closed = false;
    completed = new Promise<string>((done) => {
      const child = spawn(join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-File", `${stem}.ps1`, "-Config", `${stem}.json`], { cwd: directory, env: options.trustedGitHub ? { ...cleanEnvironment(), ...(process.env.GH_TOKEN ? { GH_TOKEN: process.env.GH_TOKEN } : {}), ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}) } : cleanEnvironment(), windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      stopSupervisor = () => { child.kill(); };
      let error = "";
      const deadline = setTimeout(() => { error = "Job supervisor exceeded its launch and cleanup allowance"; child.kill(); }, (options.timeoutSeconds + 45) * 1000);
      child.stderr.on("data", (chunk: Buffer) => { if (error.length < 65536) error += chunk.toString(); });
      child.on("error", e => { closed = true; clearTimeout(deadline); done(e.message); });
      child.on("close", () => { closed = true; clearTimeout(deadline); done(error); });
    });
    if (options.onStarted) {
      while (true) {
        let identity: ProcessIdentity | undefined;
        try { identity = JSON.parse(await readFile(`${stem}.started.json`, "utf8")) as ProcessIdentity; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (identity) { await options.onStarted(identity); break; }
        if (closed) break;
        await new Promise(done => setTimeout(done, 25));
      }
    }
    const supervisorError = await completed;
    let text: string;
    try { text = await readFile(resultPath, "utf8"); } catch { throw new Error(supervisorError || "Job supervisor did not report termination"); }
    if (text.startsWith("exited:")) termination = { kind: "exited", exitCode: Number(text.slice(7)) };
    else if (text === "timeout" || text === "cancelled") termination = { kind: text, reason: `Process ${text}` };
    else termination = { kind: "launch_error", reason: text };
  } catch (error) {
    // A failed durable start observation cannot release a live worker to verification or completion.
    if (completed) {
      try { await writeFile(cancel, "Start observation failed"); } catch { stopSupervisor?.(); }
      await completed.catch(() => {});
    }
    termination = { kind: "launch_error", reason: String(error) };
  }
  finally { options.signal?.removeEventListener("abort", abort); }
  return { executable, args, cwd, termination, stdout: await artifact(stdout), stderr: await artifact(stderr) };
}
