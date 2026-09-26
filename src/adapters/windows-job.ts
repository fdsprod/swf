import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessRecord, ProcessTermination } from "../contracts/local.js";
import { artifact } from "./local-files.js";

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
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint share,ref SECURITY sa,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
 public static string Run(string exe,string command,string cwd,string input,string output,string error,string cancel,uint owner,int timeout) {
  IntPtr job=IntPtr.Zero,ownerHandle=IntPtr.Zero,hin=IntPtr.Zero,hout=IntPtr.Zero,herr=IntPtr.Zero; PROCESS pi=new PROCESS();
  try {
   ownerHandle=OpenProcess(0x100000,false,owner); Check(ownerHandle!=IntPtr.Zero); Check(WaitForSingleObject(ownerHandle,0)==258);
   job=CreateJobObjectW(IntPtr.Zero,null); Check(job!=IntPtr.Zero); var info=new EXT();info.basic.flags=0x2000;Check(SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(info)));
   var sa=new SECURITY();sa.length=(uint)Marshal.SizeOf(sa);sa.inherit=1;
   hin=CreateFileW(input,0x80000000,3,ref sa,3,0,IntPtr.Zero);Check(hin!=new IntPtr(-1));
   hout=CreateFileW(output,0x40000000,3,ref sa,2,0,IntPtr.Zero);Check(hout!=new IntPtr(-1));
   herr=CreateFileW(error,0x40000000,3,ref sa,2,0,IntPtr.Zero);Check(herr!=new IntPtr(-1));
   var si=new STARTUP();si.cb=(uint)Marshal.SizeOf(si);si.flags=0x100;si.input=hin;si.output=hout;si.error=herr;
   Check(CreateProcessW(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x4|0x08000000,IntPtr.Zero,cwd,ref si,out pi));
   if(!AssignProcessToJobObject(job,pi.process)){TerminateProcess(pi.process,1);Check(false);}
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
 $result = [FactoryJob]::Run($c.executable,$c.command,$c.cwd,$c.input,$c.output,$c.error,$c.cancel,[uint32]$c.owner,[int]$c.timeout)
 [IO.File]::WriteAllText($c.result,$result)
} catch { [IO.File]::WriteAllText($c.result,'launch_error:' + $_.Exception.ToString()); exit 1 }
`;

// Windows CreateProcess command-line quoting, without a shell.
function quote(value: string): string { return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`; }
export function cleanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/(TOKEN|SECRET|PASSWORD|API_KEY|ASKPASS|SSH_AUTH|GIT_CONFIG|NODE_OPTIONS|NODE_PATH)/i.test(key)) delete env[key];
  return env;
}
export async function processInJob(options: { executable: string; args: string[]; cwd: string; directory: string; name: string; timeoutSeconds: number; input?: string; signal?: AbortSignal }): Promise<ProcessRecord> {
  const { executable, args, cwd, directory, name } = options;
  const stem = join(directory, name);
  const stdout = `${stem}.stdout`, stderr = `${stem}.stderr`, resultPath = `${stem}.termination`, cancel = `${stem}.cancel`;
  await Promise.all([writeFile(stdout, ""), writeFile(stderr, ""), writeFile(`${stem}.stdin`, options.input ?? ""), writeFile(`${stem}.ps1`, helper)]);
  await writeFile(`${stem}.json`, JSON.stringify({ executable, command: [executable, ...args].map(quote).join(" "), cwd, input: `${stem}.stdin`, output: stdout, error: stderr, result: resultPath, cancel, owner: process.pid, timeout: options.timeoutSeconds * 1000 }));
  const abort = (): void => { void writeFile(cancel, "cancelled"); };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) await writeFile(cancel, "cancelled");
  let termination: ProcessTermination;
  try {
    const supervisorError = await new Promise<string>((done) => {
      const child = spawn(join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-File", `${stem}.ps1`, "-Config", `${stem}.json`], { cwd: directory, env: cleanEnvironment(), windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let error = "";
      const deadline = setTimeout(() => { error = "Job supervisor exceeded its launch and cleanup allowance"; child.kill(); }, (options.timeoutSeconds + 45) * 1000);
      child.stderr.on("data", (chunk: Buffer) => { if (error.length < 65536) error += chunk.toString(); });
      child.on("error", e => { clearTimeout(deadline); done(e.message); });
      child.on("close", () => { clearTimeout(deadline); done(error); });
    });
    let text: string;
    try { text = await readFile(resultPath, "utf8"); } catch { throw new Error(supervisorError || "Job supervisor did not report termination"); }
    if (text.startsWith("exited:")) termination = { kind: "exited", exitCode: Number(text.slice(7)) };
    else if (text === "timeout" || text === "cancelled") termination = { kind: text, reason: `Process ${text}` };
    else termination = { kind: "launch_error", reason: text };
  } catch (error) { termination = { kind: "launch_error", reason: String(error) }; }
  finally { options.signal?.removeEventListener("abort", abort); }
  return { executable, args, cwd, termination, stdout: await artifact(stdout), stderr: await artifact(stderr) };
}
