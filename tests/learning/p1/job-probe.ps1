param([Parameter(Mandatory=$true)][string]$NodeExe,[Parameter(Mandatory=$true)][string]$ChildScript)
# External Win32 learning probe: create suspended, assign to kill-on-close Job, resume.
# The child intentionally exits before its grandchild. Closing the Job must still kill it.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
public static class P1JobProbe {
 [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUP { public uint cb; public string reserved,desktop,title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process,thread; public uint pid,tid; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attrs,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int klass,ref EXTENDED info,uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUP si,out PROCESS pi);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h,uint status);
 static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
 public static void Run(string exe,string script) {
  IntPtr job=CreateJobObjectW(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
  var info=new EXTENDED(); info.basic.flags=0x2000;
  Check(SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(info)));
  var si=new STARTUP(); si.cb=(uint)Marshal.SizeOf(si); PROCESS pi;
  Check(CreateProcessW(exe,new StringBuilder("\""+exe+"\" \""+script+"\""),IntPtr.Zero,IntPtr.Zero,false,0x4|0x08000000,IntPtr.Zero,null,ref si,out pi));
  try {
   if(!AssignProcessToJobObject(job,pi.process)) { TerminateProcess(pi.process,1); Check(false); }
   Check(ResumeThread(pi.thread)!=0xffffffff);
   Console.WriteLine("assigned root "+pi.pid);
   Thread.Sleep(2000);
  } finally { CloseHandle(pi.thread); CloseHandle(pi.process); CloseHandle(job); }
 }
}
'@
[P1JobProbe]::Run($NodeExe,$ChildScript)
