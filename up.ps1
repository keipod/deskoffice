# Repo-root wrapper: run from project root as .\up.ps1
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "scripts\up.ps1") @args
