# ============================================================
# 电闯关·电工大作战 - JSON数据库版 Docker 镜像
# 版本：1.4.5.1  （与 Windows 版源码一致，含 OCR 跨平台兼容）
# 基础镜像：Node 18 Alpine（与 Windows 版 pkg 打包的 node18 运行时一致）
# 构建：docker build -t dian-chuangguan-json:1.4.5.1 .
# 运行：docker run -d -p 8123:8123 -v 电闯关数据:/app/data dian-chuangguan-json:1.4.5.1
# ============================================================
FROM node:18-alpine

LABEL maintainer="空城流水老师"
LABEL description="电闯关·电工大作战 JSON数据库版服务端"
LABEL version="1.4.5.1"

ENV NODE_ENV=production
ENV PORT=8123

WORKDIR /app

# 服务端源码（server.js 已含非 Windows 平台 OCR 兼容提示）
COPY server.js store.js ocr_worker.ps1 ./
# 业务数据（db.json 账号/成绩/考试，questions.json 题库）
COPY data/ ./data/
# 前端静态资源（页面/样式/脚本/题目图片目录）
COPY public/ ./public/

# 数据持久化目录：
#   /app/data          账号、成绩、题库、考试、上传答卷等 JSON 数据
#   /app/public/qimg   教师上传的题目图片
# 首次使用建议用命名卷（docker-compose）或先复制初始数据到宿主机目录再 bind 挂载
VOLUME ["/app/data", "/app/public/qimg"]

EXPOSE 8123

# 健康检查：/api/meta 返回 200 即服务就绪
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8123/api/meta >/dev/null 2>&1 || exit 1

# 启动服务（端口可用环境变量 PORT 修改）
CMD ["node", "server.js"]
