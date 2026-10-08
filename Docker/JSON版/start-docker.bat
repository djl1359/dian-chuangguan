@echo off
chcp 65001 >nul
echo ============================================
echo  电闯关·电工大作战 - JSON版 Docker 一键启动
echo  版本 1.4.5.1
echo ============================================
echo.
echo 正在检查 Docker 环境...
docker version >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Docker，请先安装 Docker Desktop：
  echo        https://www.docker.com/products/docker-desktop/
  echo        安装后启动 Docker Desktop 再运行本脚本。
  pause
  exit /b 1
)
echo Docker 环境正常。
echo.
echo 正在构建并启动容器（首次构建约需 1-3 分钟）...
docker compose up -d --build
if errorlevel 1 (
  echo [错误] 构建/启动失败，请检查上方错误信息。
  pause
  exit /b 1
)
echo.
echo 启动成功！
echo  本机访问   : http://localhost:8123
echo  手机/其他电脑: http://本机IP:8123  （需同一局域网）
echo.
echo 常用命令：
echo   查看状态  : docker compose ps
echo   查看日志  : docker compose logs -f
echo   停止服务  : docker compose down
echo   停止并删除数据卷(慎用): docker compose down -v
echo.
pause
