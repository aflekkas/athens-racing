# Review-only draft; run serially in the isolated native Windows job.
$ErrorActionPreference = 'Stop'
$installer = Get-Item '.desktop/dist/Athens-Racing-0.1.0-x64.exe'
$installDir = Join-Path $env:RUNNER_TEMP 'AthensRacingInstalled'
$retainedProfile = Join-Path $env:APPDATA 'Athens Racing'
if (Test-Path $retainedProfile) { throw 'Default profile must be fresh on this disposable runner' }
$env:DESKTOP_EXECUTABLE = Join-Path $installDir 'Athens Racing.exe'
$env:DESKTOP_TEMP_ROOT = $env:RUNNER_TEMP
$env:DESKTOP_LIFECYCLE_PROFILE = $retainedProfile
$env:DESKTOP_EVIDENCE = Join-Path $env:GITHUB_WORKSPACE '.scratch/desktop-check/windows-native'
Remove-Item Env:ASR_GAME_ROOT -ErrorAction SilentlyContinue
# Windows replacement for the Linux-only flock browser-slot wrapper. Own named
# mutex spans all native GUI jobs; release in finally, never parallelize them.
$mutex = [Threading.Mutex]::new($false, 'Local\AthensRacingNativeBrowserSlot')
if (!$mutex.WaitOne([TimeSpan]::FromMinutes(5))) { throw 'Browser mutex timeout' }
function Invoke-Node([string[]]$NodeArguments) {
  & node @NodeArguments
  if ($LASTEXITCODE -ne 0) { throw "Node check failed: $($NodeArguments -join ' ')" }
}
function Install-App {
  if (Test-Path $installDir) { throw 'Installation target must be absent' }
  $p = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($p.ExitCode -ne 0 -or !(Test-Path $env:DESKTOP_EXECUTABLE)) { throw 'NSIS installation failed' }
}
function Uninstall-App {
  $uninstaller = Get-Item (Join-Path $installDir 'Uninstall Athens Racing.exe')
  $p = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw 'NSIS uninstallation failed' }
  # NSIS may finish its process before the final self-delete removes its tree.
  # Wait for observable completion; never delete nonempty installation contents.
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ($true) {
    $remaining = @()
    if (Test-Path -LiteralPath $installDir) {
      try { $remaining = @(Get-ChildItem -LiteralPath $installDir -Force -ErrorAction Stop) }
      catch { if (Test-Path -LiteralPath $installDir) { throw } }
    }
    if (!(Test-Path -LiteralPath $env:DESKTOP_EXECUTABLE) -and $remaining.Count -eq 0) {
      if (Test-Path -LiteralPath $installDir) {
        try { [IO.Directory]::Delete($installDir, $false) }
        catch { if (Test-Path -LiteralPath $installDir) { throw } }
      }
      break
    }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Uninstall left executable or nonempty installation directory' }
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $env:DESKTOP_EXECUTABLE) { throw 'Installed executable survived uninstall' }
  if (Test-Path -LiteralPath $installDir) { throw 'Installation directory survived uninstall' }
  if (!(Test-Path $retainedProfile)) { throw 'Uninstall removed retained user profile' }
}
try {
 Install-App
 Invoke-Node -NodeArguments @('tools/check-desktop.mjs')
 Invoke-Node -NodeArguments @('tools/check-desktop-download.mjs')
 Invoke-Node -NodeArguments @('tools/check-desktop-lan.mjs')
 Invoke-Node -NodeArguments @('tools/desktop-ci/windows-lifecycle.mjs','write')
 Uninstall-App
 Install-App
 Invoke-Node -NodeArguments @('tools/desktop-ci/windows-lifecycle.mjs','read')
 Uninstall-App
 @{passed=$true;installerSHA256=(Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower();signatureStatus=(Get-AuthenticodeSignature $installer.FullName).Status.ToString();nativeWindows=$true;hardwareGPUVerified=$false;crossMachineLANVerified=$false} | ConvertTo-Json | Set-Content (Join-Path $env:DESKTOP_EVIDENCE 'installation.json')
} finally {
 $mutex.ReleaseMutex();$mutex.Dispose()
}
