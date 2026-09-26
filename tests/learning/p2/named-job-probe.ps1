param([string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
if (-not $EvidenceDirectory) { throw 'EvidenceDirectory is required' }
$probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('swf-named-job-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $probeRoot | Out-Null
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$source = @'
using System;using System.Runtime.InteropServices;
public static class ProbeJob {
 [StructLayout(LayoutKind.Sequential)] struct BASIC {public long a,b;public uint flags;public UIntPtr min,max;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] struct EXT {public BASIC basic;public IO io;public UIntPtr pm,jm,ppm,pjm;}
 [StructLayout(LayoutKind.Sequential)] struct ACCOUNT {public long a,b,c,d;public uint faults,total,active,terminated;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObjectW(IntPtr attrs,string name);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr OpenJobObjectW(uint access,bool inherit,string name);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,int klass,ref EXT value,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool QueryInformationJobObject(IntPtr job,int klass,out ACCOUNT value,uint size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 public static IntPtr Create(string name,IntPtr process){var j=CreateJobObjectW(IntPtr.Zero,name);if(j==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();var e=new EXT();e.basic.flags=0x2000;if(!SetInformationJobObject(j,9,ref e,(uint)Marshal.SizeOf(e))||!AssignProcessToJobObject(j,process))throw new System.ComponentModel.Win32Exception();return j;}
 public static int Inspect(string name){var j=OpenJobObjectW(4,false,name);if(j==IntPtr.Zero){var error=Marshal.GetLastWin32Error();if(error==2)return -2;throw new System.ComponentModel.Win32Exception(error);}try{ACCOUNT a;if(!QueryInformationJobObject(j,1,out a,(uint)Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero))throw new System.ComponentModel.Win32Exception();return (int)a.active;}finally{CloseHandle(j);}}
}
'@
$sourcePath = Join-Path $probeRoot 'native.cs'
[IO.File]::WriteAllText($sourcePath, $source)
Add-Type -TypeDefinition $source
$supervisorPath = Join-Path $probeRoot 'supervisor.ps1'
[IO.File]::WriteAllText($supervisorPath, @'
param($Source,$Name,$Marker)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition ([IO.File]::ReadAllText($Source))
$child=Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep 60' -WindowStyle Hidden -PassThru
$handle=[ProbeJob]::Create($Name,$child.Handle)
[IO.File]::WriteAllText($Marker,($child.Id.ToString()))
Start-Sleep 60
'@)
$jobName = 'Local\SWF-learning-' + [Guid]::NewGuid()
$marker = Join-Path $probeRoot 'ready.txt'
$exe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$supervisor = Start-Process -FilePath $exe -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+$supervisorPath+'"'),'-Source',('"'+$sourcePath+'"'),'-Name',$jobName,'-Marker',('"'+$marker+'"')) -WindowStyle Hidden -PassThru
try {
 $deadline = [DateTime]::UtcNow.AddSeconds(15)
 while (-not (Test-Path -LiteralPath $marker)) { if ($supervisor.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Supervisor did not establish its named Job' }; Start-Sleep -Milliseconds 50 }
 $childId = [int][IO.File]::ReadAllText($marker)
 $active = [ProbeJob]::Inspect($jobName)
 if ($active -lt 1) { throw 'Active named Job was not observed' }
 $supervisor.Kill(); $supervisor.WaitForExit()
 $deadline = [DateTime]::UtcNow.AddSeconds(10)
 do { $remaining = [ProbeJob]::Inspect($jobName); if ($remaining -eq -2) { break }; Start-Sleep -Milliseconds 50 } while ([DateTime]::UtcNow -lt $deadline)
 if ($remaining -ne -2) { throw 'Named Job remained after owner termination' }
 $child = Get-Process -Id $childId -ErrorAction SilentlyContinue
 if ($child) { throw 'Owned child survived Job owner termination' }
 $result = [ordered]@{observedAt=[DateTime]::UtcNow.ToString('o');platform='Windows';probeRoot=$probeRoot;jobName=$jobName;activeProcessesBeforeKill=$active;afterOwnerKill='ERROR_FILE_NOT_FOUND';ownedChildStopped=$true;unrelatedMissingName=[ProbeJob]::Inspect('Local\SWF-missing-'+[Guid]::NewGuid());otherOpenErrors='Thrown, not treated as absence'}
 $json=$result | ConvertTo-Json
 [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'named-job-observations.json'),$json)
 $json
} finally { if (-not $supervisor.HasExited) { $supervisor.Kill(); $supervisor.WaitForExit() } }
