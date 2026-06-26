@echo off
chcp 65001 >nul
echo 正在停止占用 8080 端口的后端进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F
)
echo 已停止。可重新运行 deploy.bat 或 java -jar target\wx-ybhz-cavp-system-1.0.0.jar
pause
