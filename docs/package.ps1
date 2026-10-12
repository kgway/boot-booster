param()
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'prepare-candidate.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Candidate validation or packaging failed.' }
