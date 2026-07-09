@echo off
chcp 65001 >nul
setlocal
cd /d %~dp0

echo ========================================
echo  宜泊慧智 C-AVP 后端部署脚本
echo ========================================

:: 1. 查找 Maven
set "MVN="
where mvn >nul 2>&1 && set "MVN=mvn"
if not defined MVN if exist "%TEMP%\apache-maven-3.9.6\bin\mvn.cmd" set "MVN=%TEMP%\apache-maven-3.9.6\bin\mvn.cmd"
if not defined MVN if exist "C:\Program Files\Apache\maven\bin\mvn.cmd" set "MVN=C:\Program Files\Apache\maven\bin\mvn.cmd"

if not defined MVN (
  echo [1/3] 未找到 Maven，正在下载到 %%TEMP%% ...
  powershell -NoProfile -Command ^
    "$z='$env:TEMP\apache-maven.zip'; $h='$env:TEMP\apache-maven-3.9.6';" ^
    "if (-not (Test-Path \"$h\bin\mvn.cmd\")) {" ^
    "  Invoke-WebRequest -Uri 'https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.zip' -OutFile $z;" ^
    "  Expand-Archive -Path $z -DestinationPath $env:TEMP -Force }"
  set "MVN=%TEMP%\apache-maven-3.9.6\bin\mvn.cmd"
)

if not exist "%MVN%" (
  echo [错误] Maven 不可用。请安装 Maven 或用 IntelliJ 打开项目运行 WxYbhzCavpApplication
  pause
  exit /b 1
)

echo [1/3] 使用 Maven: %MVN%

:: 1.5 若 12380 已被占用（旧后端还在跑），先结束进程，避免 jar 被锁导致 BUILD FAILURE
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":12380" ^| findstr "LISTENING"') do (
  echo [提示] 端口 12380 被进程 %%a 占用，正在结束...
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: 2. 检查地图数据
if not exist "data\maps\ziguang_1-B2\parking.mbtiles" (
  echo [警告] 地图数据缺失！请先确保 F:\osmandroid\...\build\generated\assets\osm 存在
  echo        或手动复制 data 目录
)

:: 3. 编译并启动
echo [2/3] 编译中...
call "%MVN%" -DskipTests package
if errorlevel 1 (
  echo [错误] 编译失败
  pause
  exit /b 1
)

echo [3/3] 启动服务 http://localhost:12380
echo        按 Ctrl+C 停止
call "%MVN%" spring-boot:run
