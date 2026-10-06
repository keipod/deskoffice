# Repo-root wrapper: run from project root as .\down.ps1
$ErrorActionPreference = "Continue"
& (Join-Path $PSScriptRoot "scripts\down.ps1") @args
