<#
.SYNOPSIS
  为 DSH 侧边栏安装可选的 `sidebar.energy` 座位（与 ui-sidebar-sidebar-energy.patch 等价）。
  Content-anchored installer for the optional `sidebar.energy` seat
  (equivalent to ui-sidebar-sidebar-energy.patch).

.DESCRIPTION
  不依赖行号，而是按唯一的代码锚点做文本插入，因此在任何较新版本的
  deepseek-harness 上都能工作，即使 git apply 报 "patch does not apply"。
  可重复运行：已存在的修改会自动跳过（幂等）。
  Edits by unique content anchors instead of line numbers, so it works on any
  recent deepseek-harness checkout even when git apply fails. Idempotent:
  edits already present are skipped, so running it again is safe.

.PARAMETER RepoRoot
  deepseek-harness 仓库根目录（包含 packages/client/ui-sidebar 的那个目录）。
  默认为当前目录。Path to the deepseek-harness checkout root. Defaults to the
  current directory.

.EXAMPLE
  cd D:\Opencode\deepseek-harness\deepseek-harness
  powershell -ExecutionPolicy Bypass -File ..\..\dsh-green-meter\patches\apply-sidebar-energy.ps1
#>
param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$script:failed = $false
$utf8nobom = [System.Text.UTF8Encoding]::new($false)

function Get-Eol([string]$content) {
  if ($content.Contains("`r`n")) { return "`r`n" }
  return "`n"
}

function Edit-ByAnchor(
  [string]$path,
  [string]$anchor,      # 必须恰好出现一次的锚点文本 (literal text, must occur exactly once)
  [string]$text,        # 要插入的文本 (text to insert)
  [string]$alreadyMark, # 已存在标记，命中则跳过 (idempotency marker; skip when present)
  [bool]$before)        # $true = 插到锚点之前 (insert before the anchor)
{
  $content = [System.IO.File]::ReadAllText($path)
  if ($content.Contains($alreadyMark)) {
    Write-Host ("[skip] 已存在: {0}" -f (Split-Path $path -Leaf))
    return
  }
  if (-not $content.Contains($anchor)) {
    Write-Host ("[FAIL] 找不到锚点: {0}  <-  {1}" -f (Split-Path $path -Leaf), $anchor)
    $script:failed = $true
    return
  }
  $idx = $content.IndexOf($anchor)
  if ($content.IndexOf($anchor, $idx + 1) -ge 0) {
    Write-Host ("[FAIL] 锚点出现多次，请人工处理: {0}" -f (Split-Path $path -Leaf))
    $script:failed = $true
    return
  }
  if ($before) {
    $new = $content.Substring(0, $idx) + $text + $content.Substring($idx)
  } else {
    $new = $content.Substring(0, $idx + $anchor.Length) + $text + $content.Substring($idx + $anchor.Length)
  }
  [System.IO.File]::WriteAllText($path, $new, $utf8nobom)
  Write-Host ("[ok]   已修改: {0}" -f (Split-Path $path -Leaf))
}

$base = Join-Path $RepoRoot 'packages/client/ui-sidebar/src/client'
$paths = @{
  index = Join-Path $base 'index.ts'
  slots = Join-Path $base 'contract/slots.ts'
  root  = Join-Path $base 'SidebarRoot.tsx'
  css   = Join-Path $base 'SidebarRoot.module.css'
}

Write-Host "RepoRoot: $RepoRoot"
foreach ($p in $paths.Values) {
  if (-not (Test-Path $p)) {
    Write-Host "[FAIL] 文件不存在: $p"
    $script:failed = $true
  }
}
if ($script:failed) {
  Write-Host '已中止。请确认 RepoRoot 指向 deepseek-harness 仓库根目录（内含 packages/client/ui-sidebar）。'
  exit 1
}

# 1) index.ts: 注册 'sidebar.energy' 座位（单例、会话作用域）。
$p = $paths['index']; $c = [System.IO.File]::ReadAllText($p); $nl = Get-Eol $c
Edit-ByAnchor $p `
  "'sidebar.footer.action': { kind: 'list', scope: 'root' }," `
  ($nl + "        'sidebar.energy': { kind: 'single', scope: 'session' },") `
  "'sidebar.energy': { kind: 'single', scope: 'session' }," `
  $false

# 2) contract/slots.ts: 声明座位类型 + 并入 SidebarRoot 的渲染槽列表。
$p = $paths['slots']; $c = [System.IO.File]::ReadAllText($p); $nl = Get-Eol $c
Edit-ByAnchor $p `
  "'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }" `
  ($nl + "    /**" + $nl + "     * Optional energy/carbon panel seat between the browsing region and the" + $nl + "     * foot. Session-scoped so occupants receive the current-session kit" + $nl + "     * (``sessionId`` + ``useProjection``); renders only while a session is" + $nl + "     * current, mirroring the layout ``details`` column semantics." + $nl + "     */" + $nl + "    'sidebar.energy': { kind: 'single'; scope: 'session'; owner: SidebarSectionOwnerProps }") `
  "'sidebar.energy': { kind: 'single'; scope: 'session'; owner: SidebarSectionOwnerProps }" `
  $false

$p = $paths['slots']; $c = [System.IO.File]::ReadAllText($p); $nl = Get-Eol $c
$old2 = "PropsRenderSlots<'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action'>"
$new2 = "PropsRenderSlots<'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action' | 'sidebar.energy'>"
if ($c.Contains($new2)) {
  Write-Host '[skip] 已存在: slots.ts (render slots)'
} elseif (-not $c.Contains($old2)) {
  Write-Host '[FAIL] 找不到锚点: slots.ts  <-  PropsRenderSlots'
  $script:failed = $true
} else {
  $count = ([regex]::Matches($c, [regex]::Escape($old2))).Count
  if ($count -ne 1) { Write-Host '[FAIL] 锚点出现多次，请人工处理: slots.ts'; $script:failed = $true }
  else {
    $c2 = $c.Replace($old2, $new2)
    [System.IO.File]::WriteAllText($p, $c2, $utf8nobom)
    Write-Host '[ok]   已修改: slots.ts (render slots)'
  }
}

# 3) SidebarRoot.tsx: 在浏览区与底栏之间渲染座位。
$p = $paths['root']; $c = [System.IO.File]::ReadAllText($p); $nl = Get-Eol $c
Edit-ByAnchor $p `
  '      {/* Footer actions stack above Settings in both sidebar widths. */}' `
  ("      {/* Optional energy panel seat between the browsing region and the foot" + $nl + "          (the green-meter detail panel registers here). */}" + $nl + "      <div className={css.energyArea}>" + $nl + "        {renderSlot('sidebar.energy', {" + $nl + "          wide," + $nl + "          expandSidebar: () => { if (collapsed) toggleSidebar() }," + $nl + "        })}" + $nl + "      </div>" + $nl + $nl) `
  "renderSlot('sidebar.energy'" `
  $true

# 4) SidebarRoot.module.css: 座位样式 + 折叠态过渡列表。
$p = $paths['css']; $c = [System.IO.File]::ReadAllText($p); $nl = Get-Eol $c
Edit-ByAnchor $p `
  '/* Footer seats:' `
  ("/* Optional energy panel seat between the region and the foot. Shrinks with" + $nl + "   the column and hides in the collapsed rail (wide-only content). */" + $nl + ".energyArea {" + $nl + "  flex: none;" + $nl + "  min-width: 0;" + $nl + "  width: 100%;" + $nl + "  margin-bottom: 8px;" + $nl + "}" + $nl + $nl + ".collapsed .energyArea {" + $nl + "  display: none;" + $nl + "}" + $nl + $nl) `
  '.energyArea {' `
  $true

$p = $paths['css']; $c = [System.IO.File]::ReadAllText($p); $nl = Get-Eol $c
if ($c.Contains('.railIn .energyArea {')) {
  Write-Host '[skip] 已存在: SidebarRoot.module.css (rail transition)'
} elseif (-not $c.Contains('  .railIn .regionArea {')) {
  Write-Host '[FAIL] 找不到锚点: SidebarRoot.module.css  <-  缩进的 .railIn .regionArea {'
  $script:failed = $true
} else {
  $count = ([regex]::Matches($c, [regex]::Escape('  .railIn .regionArea {'))).Count
  if ($count -ne 1) { Write-Host '[FAIL] 锚点出现多次，请人工处理: SidebarRoot.module.css'; $script:failed = $true }
  else {
    $c2 = $c.Replace('  .railIn .regionArea {', '  .railIn .regionArea,' + $nl + '  .railIn .energyArea {')
    [System.IO.File]::WriteAllText($p, $c2, $utf8nobom)
    Write-Host '[ok]   已修改: SidebarRoot.module.css (rail transition)'
  }
}

if ($script:failed) {
  Write-Host ''
  Write-Host '有步骤未完成（见上面 [FAIL]）。把失败信息发给我们即可。'
  exit 1
}

Write-Host ''
Write-Host '全部完成！下一步重建 ui-sidebar 包，然后刷新页面：'
Write-Host '  pnpm --filter @deepseek-ai/dsh-client-ui-sidebar bundle'
Write-Host '（然后在 cordis.patch.yml 里把客户端插件的 panelPlacement 设为 sidebar）'
exit 0
