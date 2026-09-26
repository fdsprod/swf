param(
  [Parameter(Mandatory=$true)][int]$FactoryPid,
  [Parameter(Mandatory=$true)][string]$FactoryScript,
  [Parameter(Mandatory=$true)][string]$FixtureExecutable,
  [Parameter(Mandatory=$true)][string]$VerifierScript,
  [Parameter(Mandatory=$true)][long]$FixtureStartedMilliseconds,
  [Parameter(Mandatory=$true)][string]$ReadyPath,
  [Parameter(Mandatory=$true)][string]$ControlPath,
  [Parameter(Mandatory=$true)][string]$ReplyPath
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Text;
using System.Runtime.InteropServices;
public static class HeldVerifierProcess {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern uint GetFinalPathNameByHandle(IntPtr file, StringBuilder path, uint size, uint flags);
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr process);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr process);
  public static string FileIdentityPath(string path) {
    using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
      var name = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandle(file.SafeFileHandle.DangerousGetHandle(), name, (uint)name.Capacity, 0);
      if (length == 0 || length >= name.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
      return name.ToString();
    }
  }
}
'@
function Write-AtomicJson([string]$Path, $Value) {
  [IO.File]::WriteAllText($Path + '.tmp', ($Value | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath ($Path + '.tmp') -Destination $Path -Force
}
function Open-ObservedProcess($Observed, [string]$Role) {
  $handle = [HeldVerifierProcess]::OpenProcess(0x1801, $false, $Observed.ProcessId)
  if ($handle -eq [IntPtr]::Zero) { throw "Cannot retain owned $Role process handle" }
  try {
    [long]$created = 0; [long]$exited = 0; [long]$kernel = 0; [long]$user = 0
    if (-not [HeldVerifierProcess]::GetProcessTimes($handle, [ref]$created, [ref]$exited, [ref]$kernel, [ref]$user)) { throw 'Cannot read owned process creation identity' }
    $name = New-Object Text.StringBuilder 32768; [int]$size = $name.Capacity
    if (-not [HeldVerifierProcess]::QueryFullProcessImageName($handle, 0, $name, [ref]$size)) { throw 'Cannot read owned process executable identity' }
    if (-not [String]::Equals([HeldVerifierProcess]::FileIdentityPath($name.ToString()), [HeldVerifierProcess]::FileIdentityPath($Observed.ExecutablePath), [StringComparison]::OrdinalIgnoreCase)) { throw 'Owned process executable changed before handle acquisition' }
    $cimCreated = $Observed.CreationDate.ToUniversalTime().ToFileTimeUtc()
    if ([Math]::Abs($created - $cimCreated) -ge 10) { throw 'Owned process creation identity changed before handle acquisition' }
    return [pscustomobject]@{ role=$Role; pid=[int]$Observed.ProcessId; createdAt=$created.ToString(); executable=$name.ToString(); handle=$handle }
  } catch { [void][HeldVerifierProcess]::CloseHandle($handle); throw }
}
function Is-Alive($Process) {
  [uint32]$code = 0
  if (-not [HeldVerifierProcess]::GetExitCodeProcess($Process.handle, [ref]$code)) { throw 'Cannot determine retained process liveness' }
  return $code -eq 259
}
function Observation($Processes) {
  return @($Processes | ForEach-Object { [pscustomobject]@{ role=$_.role; pid=$_.pid; createdAt=$_.createdAt; executable=$_.executable; alive=(Is-Alive $_) } })
}
$retained = @(); $suspended = $false; $supervisorHandle = $null; $factoryHandle = $null
try {
  $searchDeadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $all = @(Get-CimInstance Win32_Process -OperationTimeoutSec 5)
    $verifiers = @($all | Where-Object { $_.ExecutablePath -eq $FixtureExecutable -and $_.CommandLine.Contains($VerifierScript) -and $_.CreationDate.ToUniversalTime() -ge [DateTimeOffset]::FromUnixTimeMilliseconds($FixtureStartedMilliseconds).UtcDateTime })
    $descendants = @()
    if ($verifiers.Count -eq 1) { $descendants = @($all | Where-Object { $_.ParentProcessId -eq $verifiers[0].ProcessId -and $_.ExecutablePath -eq $FixtureExecutable }) }
    if ($verifiers.Count -eq 1 -and $descendants.Count -gt 0) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $searchDeadline)
  if ($verifiers.Count -ne 1 -or $descendants.Count -ne 1) { throw 'Expected exactly one active fixture verifier and its descendant' }
  $byId = @{}; foreach ($entry in $all) { $byId[[int]$entry.ProcessId] = $entry }
  $cursor = [int]$verifiers[0].ParentProcessId; $supervisor = $null; $seen = @{}
  while ($cursor -ne $FactoryPid) {
    if ($seen.ContainsKey($cursor) -or -not $byId.ContainsKey($cursor)) { throw 'Verifier ancestry does not reach the owned factory' }
    $seen[$cursor] = $true; $entry = $byId[$cursor]
    if ($null -eq $supervisor -and ([IO.Path]::GetFileName($entry.ExecutablePath) -in @('powershell.exe','pwsh.exe'))) { $supervisor = $entry }
    $cursor = [int]$entry.ParentProcessId
  }
  if ($null -eq $supervisor -or -not $byId.ContainsKey($FactoryPid)) { throw 'Owned PowerShell supervisor was not found in the factory ancestry' }
  $factory = $byId[$FactoryPid]
  if (-not $factory.CommandLine.Contains($FactoryScript) -or $factory.CreationDate.ToUniversalTime() -lt [DateTimeOffset]::FromUnixTimeMilliseconds($FixtureStartedMilliseconds).UtcDateTime) { throw 'Factory instance does not match this fixture invocation' }
  $factoryHandle = Open-ObservedProcess $factory 'factory'
  if ($supervisor.CreationDate.ToUniversalTime() -lt [DateTimeOffset]::FromUnixTimeMilliseconds($FixtureStartedMilliseconds).UtcDateTime) { throw 'Supervisor predates this fixture' }
  $supervisorHandle = Open-ObservedProcess $supervisor 'supervisor'; $retained += $supervisorHandle
  $retained += Open-ObservedProcess $verifiers[0] 'verifier'
  $retained += Open-ObservedProcess $descendants[0] 'descendant'
  if ([HeldVerifierProcess]::NtSuspendProcess($supervisorHandle.handle) -ne 0) { throw 'Cannot suspend the owned supervisor' }
  $suspended = $true
  Write-AtomicJson $ReadyPath @{ processes=(Observation $retained) }
  $holdDeadline = [DateTime]::UtcNow.AddSeconds(90); $lastNonce = ''
  while ([DateTime]::UtcNow -lt $holdDeadline) {
    if (Test-Path -LiteralPath $ControlPath) {
      $control = [IO.File]::ReadAllText($ControlPath) | ConvertFrom-Json
      if ($control.nonce -ne $lastNonce) {
        $lastNonce = $control.nonce
        if ($control.action -eq 'release') { break }
        if ($control.action -eq 'terminate-factory') {
          if (-not (Is-Alive $factoryHandle)) { throw 'Owned factory exited before native termination' }
          if (-not [HeldVerifierProcess]::TerminateProcess($factoryHandle.handle, 178)) { throw 'Cannot terminate the retained factory process' }
        } elseif ($control.action -ne 'probe') { throw 'Unknown supervisor-hold control' }
        Write-AtomicJson $ReplyPath @{ nonce=$lastNonce; processes=(Observation $retained) }
      }
    }
    Start-Sleep -Milliseconds 25
  }
} finally {
  if ($suspended -and $null -ne $supervisorHandle -and (Is-Alive $supervisorHandle)) { [void][HeldVerifierProcess]::NtResumeProcess($supervisorHandle.handle) }
  # Retained handles refer only to this fixture's verified process instances, even after PID reuse.
  foreach ($entry in $retained) {
    try { if (Is-Alive $entry) { [void][HeldVerifierProcess]::TerminateProcess($entry.handle, 177) } }
    finally { [void][HeldVerifierProcess]::CloseHandle($entry.handle) }
  }
  if ($null -ne $factoryHandle) { [void][HeldVerifierProcess]::CloseHandle($factoryHandle.handle) }
}
