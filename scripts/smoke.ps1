[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port = 3031)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$priorPort = $env:PORT
$env:PORT = [string]$Port
$baseUrl = "http://127.0.0.1:$Port"
$serverProcess = $null
Push-Location -LiteralPath $projectRoot
try {
  if (-not (Test-Path -LiteralPath 'work/build/apps/server/src/main.js')) { throw 'Run npm run build before the fixture smoke check.' }
  $serverProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('work/build/apps/server/src/main.js', '--fixture') -WindowStyle Hidden -PassThru -RedirectStandardOutput 'work/smoke-server.stdout.log' -RedirectStandardError 'work/smoke-server.stderr.log'
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($serverProcess.HasExited) { throw 'Fixture server exited before readiness.' }
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/health/ready" -TimeoutSec 1
      if ($health.status -eq 'ready') { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 100 }
  }
  if (-not $ready) { throw 'Fixture server did not become ready.' }
  $demoCredentials = Get-Content -LiteralPath 'work/demo-credentials.json' -Raw | ConvertFrom-Json
  $requestHeaders = @{ Authorization = ('Bearer ' + $demoCredentials[0].token); Accept = 'application/json, text/event-stream'; 'Mcp-Protocol-Version' = '2026-07-28'; 'Mcp-Method' = 'tools/list' }
  $requestMeta = @{ 'io.modelcontextprotocol/protocolVersion' = '2026-07-28'; 'io.modelcontextprotocol/clientInfo' = @{name='build-smoke';version='1'}; 'io.modelcontextprotocol/clientCapabilities' = @{} }
  $listingBody = @{jsonrpc='2.0';id=1;method='tools/list';params=@{_meta=$requestMeta}} | ConvertTo-Json -Depth 15
  $listing = Invoke-RestMethod -Uri "$baseUrl/mcp" -Method Post -ContentType 'application/json' -Headers $requestHeaders -Body $listingBody
  foreach ($toolName in @('ticket_search','ticket_context','ticket_update','ticket_note_add','time_log_ticket','ticket_document_work','ticket_handoff','ticket_resolve','schedule_search','service_call_create','my_workday','ticket_prepare_visit','at_operation_reconcile','at_job_start','at_playbook_get','at_discover','at_validate','at_query')) {
    if ($toolName -notin $listing.result.tools.name) { throw "Required technician tool missing: $toolName" }
  }
  function Invoke-FixtureTool([string]$Name, [hashtable]$Arguments) {
    $requestHeaders['Mcp-Method'] = 'tools/call'
    $requestHeaders['Mcp-Name'] = $Name
    $body = @{jsonrpc='2.0';id=2;method='tools/call';params=@{_meta=$requestMeta;name=$Name;arguments=$Arguments}} | ConvertTo-Json -Depth 25
    $response = Invoke-RestMethod -Uri "$baseUrl/mcp" -Method Post -ContentType 'application/json' -Headers $requestHeaders -Body $body -TimeoutSec 30
    if ($response.result.isError -or $response.error) { throw "Fixture tool failed: $Name" }
    return $response.result.structuredContent
  }
  $console = Invoke-WebRequest -Uri "$baseUrl/admin" -TimeoutSec 5
  if ($console.StatusCode -ne 200 -or $console.Content -notmatch 'Operations workspace') { throw 'Console page unavailable.' }
  $auth = Invoke-RestMethod -Uri "$baseUrl/admin/auth/fixture" -Method Post -Headers @{Origin=$baseUrl} -ContentType 'application/json' -Body (@{token=$demoCredentials[0].token} | ConvertTo-Json) -SessionVariable consoleSession
  $snapshot = Invoke-RestMethod -Uri "$baseUrl/admin/api/snapshot" -WebSession $consoleSession
  if ($snapshot.members.Count -ne 2 -or $snapshot.config.mode -ne 'fixture') { throw 'Console authenticated snapshot mismatch.' }
  $ticket = @{kind='id';id=1001}
  $contextArgs = @{ticket=$ticket;purpose='custom';collections=@('notes','time')}
  $context = Invoke-FixtureTool 'ticket_context' $contextArgs
  if ($context.data.collections.notes.returned -ne 105) { throw 'Expected complete notes collection.' }
  $updateArgs = @{ticket=$ticket;request_key='smoke-title-update';changes=@{title='Smoke test restored'};expected=@{title='Example printer offline'}}
  $write = Invoke-FixtureTool 'ticket_update' $updateArgs
  if ($write.status -ne 'succeeded_verified') { throw 'Expected verified fixture title update.' }
  $replay = Invoke-FixtureTool 'ticket_update' $updateArgs
  if ($replay.operation_id -ne $write.operation_id) { throw 'Replay did not preserve operation identity.' }
  $documentArgs = @{ticket=$ticket;request_key='smoke-document-work';note=@{title='Smoke work note';text='Fictitious printer diagnostic work.';audience='internal'};time=@{work_date='2026-09-10';timezone='America/Chicago';minutes=30;summary='Fictitious diagnostic time.'}}
  $validation = Invoke-FixtureTool 'at_validate' @{operation='ticket_document_work';arguments=$documentArgs}
  if (-not $validation.valid -or $validation.effects -ne 'none') { throw 'Expected read-only workflow preflight.' }
  $document = Invoke-FixtureTool 'ticket_document_work' $documentArgs
  if ($document.status -ne 'succeeded_verified') { throw 'Expected verified note and time workflow.' }
  $documentReplay = Invoke-FixtureTool 'ticket_document_work' $documentArgs
  if ($documentReplay.operation_id -ne $document.operation_id) { throw 'Document-work replay did not preserve operation identity.' }
  $after = Invoke-FixtureTool 'ticket_context' $contextArgs
  if ($after.data.collections.notes.returned -ne 106) { throw 'Expected exactly one additional note after replay.' }
  if ($after.data.collections.time.returned -ne ($context.data.collections.time.returned + 1)) { throw 'Expected exactly one additional time entry after replay.' }
  $book = Invoke-FixtureTool 'at_playbook_get' @{id='handoff'}
  if ($book.lifecycle -ne 'draft' -or -not $book.body_sha256) { throw 'Expected versioned procedure draft.' }
  [PSCustomObject]@{Executable='built Node server';Protocol='2026-07-28';Tools=$listing.result.tools.Count;Console='authenticated';OriginalNotes=105;TitleUpdate=$write.status;DocumentWork=$document.status;SameKeyReplay='same operations, no duplicate note/time';Source='fixture'} | ConvertTo-Json
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id; $serverProcess.WaitForExit() }
  $env:PORT = $priorPort
  Pop-Location
  Write-Output 'Fixture smoke server stopped.'
}
