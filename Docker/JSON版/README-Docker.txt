====================================================================
 电闯关·电工大作战（JSON数据库版） Docker 部署说明
 版本：1.4.5.1  发布日期：2026-10-09
====================================================================

一、这是什么
--------------------------------------------------------------------
将《电闯关·电工大作战》JSON数据库版服务端打包为 Docker 镜像，
可在任何装有 Docker 的服务器（Windows / Linux / Mac / NAS）上运行，
电脑和手机通过浏览器访问，实现局域网或公网部署。

二、环境要求
--------------------------------------------------------------------
1. 安装 Docker
   - Windows：Docker Desktop（https://www.docker.com/products/docker-desktop/）
   - Linux：  docker 与 docker compose 插件
   - 服务器/NAS：群晖、威联通等自带 Docker 套件
2. 端口：默认 8123（可修改 docker-compose.yml 中 ports 和 environment）

三、快速开始
--------------------------------------------------------------------
方式一：Windows 一键脚本
  1. 进入本目录「电闯关-服务端-JSON版-Docker」
  2. 双击 start-docker.bat
  3. 浏览器访问 http://localhost:8123

方式二：命令行
  docker compose up -d --build
  浏览器访问 http://localhost:8123

方式三：单条 docker 命令（不用 compose）
  docker build -t dian-chuangguan-json:1.4.5.1 .
  docker run -d --name dian-chuangguan -p 8123:8123 \
    -v 电闯关数据:/app/data \
    dian-chuangguan-json:1.4.5.1

四、数据持久化（重要）
--------------------------------------------------------------------
容器删除后数据不丢失，必须使用卷（volume）持久化：

  - json-data 卷 → /app/data
      账号、积分、成绩、题库、考试、日志等全部业务数据
      （db.json / questions.json / 上传答卷）
  - qimg-data 卷 → /app/public/qimg
      教师上传的题目图片

docker-compose.yml 已配置好两个命名卷，首次启动自动创建并从
镜像复制初始数据（含 2649 道题库与 teacher 账号）。

五、初始账号
--------------------------------------------------------------------
  教师：teacher / 123456
  学生：注册页面自行注册（同 Windows 版）

六、功能差异说明（与 Windows 版对比）
--------------------------------------------------------------------
  ✅ 完全一致：闯关、章节地图、题库管理、学生管理、成绩分析、
     组卷/阅卷/答题卡、在线考试、CSV 导入、截图上传题目图片、
     语音读题、版本信息、版权信息等
  ⚠️ OCR 文字识别（题库管理-新增题目-文字识别）：
     Windows 版使用系统 PowerShell 中文 OCR 引擎；
     Docker/Linux 环境无此组件，调用时会返回明确提示，
     可改用「截图上传图片」或手动录入题目。（功能降级，非故障）

七、常用运维命令
--------------------------------------------------------------------
  查看状态      : docker compose ps
  查看日志      : docker compose logs -f
  停止服务      : docker compose down          （数据保留）
  停止并清数据  : docker compose down -v       （⚠️ 慎用，清空全部数据）
  更新镜像      : 替换本目录源码后 docker compose up -d --build
  端口修改      : 编辑 docker-compose.yml 中 "8123:8123" 左侧宿主机端口

八、备份与迁移
--------------------------------------------------------------------
  备份：docker run --rm -v 电闯关数据:/data -v %cd%:/backup alpine \
        tar czf /backup/电闯关备份-日期.tar.gz -C /data .
  恢复：docker run --rm -v 电闯关数据:/data -v %cd%:/backup alpine \
        tar xzf /backup/电闯关备份-日期.tar.gz -C /data
  说明：备份文件为 tar.gz，含 db.json / questions.json / 上传文件。

====================================================================
 版权：河北省滦州市职业技术教育中心 空城流水老师利用豆包AI制做
 仓库：https://github.com/djl1359/dian-chuangguan
====================================================================
