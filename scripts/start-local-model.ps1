# 启动本地小模型（llama.cpp + Qwen2.5-0.5B），供 DSH 通过 OpenAI 兼容端点使用。
#
# 用法：powershell -ExecutionPolicy Bypass -File scripts\start-local-model.ps1
# 默认端口 1234；DSH 的 provider 配置见 %DSH_HOME%\settings.yaml（本应用为
# resources\harness\dsh-home\settings.yaml，provider: local-llamacpp）。
param(
  [int]$Port = 1234,
  [int]$Context = 16384,
  [int]$Threads = 6,
  [string]$Model = "D:\models\qwen2.5-0.5b-instruct-q4_k_m.gguf",
  [string]$Server = "D:\models\llama-b10868\llama-server.exe"
)

if (-not (Test-Path $Server)) { throw "找不到 llama-server.exe：$Server" }
if (-not (Test-Path $Model)) { throw "找不到模型文件：$Model" }

Write-Host "启动本地模型：$Model"
Write-Host "端点：http://127.0.0.1:$Port/v1  （上下文 $Context，线程 $Threads）"
& $Server -m $Model --host 127.0.0.1 --port $Port -c $Context -t $Threads --no-webui --alias qwen2.5-0.5b-instruct
