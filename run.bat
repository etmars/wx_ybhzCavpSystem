@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

cd /d %~dp0
echo ========================================
echo  宜泊慧智 C-AVP 后端启动脚本
echo ========================================

:: 1. 查找 Maven
set "MVN="
where mvn >nul 2>&1 && set "MVN=mvn"

if not defined MVN (
  if exist "%TEMP%\apache-maven-3.9.6\bin\mvn.cmd" (
    set "MVN=%TEMP%\apache-maven-3.9.6\bin\mvn.cmd"
  )
)

if not defined MVN (
  echo.
  echo [错误] 未找到 Maven。请任选一种方式：
  echo   1. 安装 Maven 并加入 PATH
  echo      https://maven.apache.org/download.cgi
  echo   2. 用 IntelliJ IDEA 打开本项目，运行 WxYbhzCavpApplication
  echo   3. 重新运行本脚本（首次会自动下载 Maven 到 %%TEMP%%）
  echo.
  set "MZIP=%TEMP%\apache-maven.zip"
  set "MHOME=%TEMP%\apache-maven-3.9.6"
  if not exist "%MHOME%\bin\mvn.cmd" (
    echo 正在下载 Maven 3.9.6 ...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.zip' -OutFile '%MZIP%'; Expand-Archive -Path '%MZIP%' -DestinationPath '%TEMP%' -Force"
  )
  if exist "%MHOME%\bin\mvn.cmd" (
    set "MVN=%MHOME%\bin\mvn.cmd"
  ) else (
    pause
    exit /b 1
  )
)

:: 2. 检查地图数据
if not exist "data\maps\ziguang_1-B2\parking.mbtiles" (
  echo.
  echo [警告] 地图数据不完整。请确认 data\maps 目录存在。
  echo 或修改 application.yml 中的 osmandroid-assets 路径后重启。
  echo.
)

:: 3. 编译并启动
echo.
echo 使用 Maven: %MVN%
echo 启动地址: http://localhost:8080
echo 按 Ctrl+C 停止服务
echo.

"%MVN%" -DskipTests spring-boot:run
pause
