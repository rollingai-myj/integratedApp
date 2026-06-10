# detect-service 部署说明（商品识别微服务）

## 概述

`detect-service` 是一个 Python FastAPI 微服务，给整合 app 的 `/api/v1/detect` 路由作为下游：

```
前端 PhotoPage 拍照 → POST /api/v1/detect { imageBase64 }
                       ↓
            apps/api/src/services/detect.service.ts
                       ↓ multipart 转发
            FastAPI POST {DETECT_SERVICE_URL}/detect
                       ↓
        Roboflow YOLO → PE Embed → Qdrant 向量检索 + OCR
                       ↓
            返回 boxes[{ x, y, w, h, sku_code, confidence }]
```

## 依赖

| 组件 | 用途 | 必需性 |
|---|---|---|
| **GPU**（CUDA 11+）或 AutoDL 实例 | PE Embed 推理 | 必需，CPU 推理可工作但每张图慢 30s+ |
| **Roboflow API key** | YOLO 商品检测 | 必需 |
| **Qdrant**（云或自建） | PE embedding 向量库 | 必需 |
| **PE 模型权重** | 商品 embedding 提取 | 必需，约 2GB |
| **RapidOCR** | 文字辅助识别（包装上的品牌名） | 可选 |

## 部署模式

### A. 本地 GPU 机器

```bash
# 1. 拉源码（来自原 skuSelection repo，复用 detect-service/）
git clone https://github.com/rollingai-myj/skuSelection.git
cd skuSelection/detect-service

# 2. 装依赖（建议虚拟环境）
pip install -r requirements.txt
pip install git+https://github.com/facebookresearch/perception_models.git

# 3. 配置 env
cat > .env <<EOF
ROBOFLOW_API_KEY=xxx
QDRANT_URL=https://xxx.qdrant.io:6333
QDRANT_API_KEY=xxx
EMBED_BATCH=8
QDRANT_CONCURRENCY=8
EOF

# 4. 启动（端口 8000）
uvicorn app:app --host 0.0.0.0 --port 8000

# 5. 整合 app api 配置（apps/api/.env）
DETECT_SERVICE_URL=http://localhost:8000
```

### B. AutoDL 远程 GPU + SSH 隧道

适用于本机没 GPU 但已租 AutoDL 实例的情况。

```bash
# AutoDL 实例内：
cd /root/skuSelection/detect-service
uvicorn app:app --host 0.0.0.0 --port 6006   # AutoDL 标准开放端口

# 本地终端保持开启 SSH 隧道：
ssh -CNg -L 6006:127.0.0.1:6006 root@<autodl-ip> -p <ssh-port>

# 整合 app api 配置：
DETECT_SERVICE_URL=http://localhost:6006
```

### C. Docker compose 全量部署

参考 `services/detect/docker-compose.yml`（M5-PR3 提供）。

## 不部署的影响

不部署 detect-service 不会阻塞选品流程：

- ✅ 拍照、上传、诊断（Dify ALIGN）、选品方案（Dify SELECTION）、一键应用、虚拟货架生成 **全部能正常工作**
- ❌ 货架照片上不会画红框标注 "问题单品"
- ✅ UI 会显式提示 "商品识别服务暂不可用"（V028 起；之前是 silent catch 不提示）

详见 `apps/web/src/components/shelves/pages/PhotoPage.tsx` 的 `detectError` 处理。

## 调试

测试是否在线：
```bash
curl -X POST $DETECT_SERVICE_URL/detect \
  -F "image=@/path/to/shelf-photo.jpg"
# 期望：200 + JSON { boxes: [...] }
# 502 / 超时 / 连接拒绝 = 服务未启动或网络不通
```

整合 app 后端日志查看：
```bash
docker logs myj-api 2>&1 | grep "detect-service"
```

## 常见问题

**Q: 整合 app 后端报 "检测服务返回 502" 但 detect-service 看起来在跑**
- 检查 `DETECT_SERVICE_URL` 是否填了 `http://` 前缀
- 检查 Qdrant 集合是否已 index 当前店的 SKU embeddings（detect-service 启动日志会打印）

**Q: 红框乱标，准确率很低**
- 检查 Qdrant 向量库是否包含目标 SKU 的样本图（缺样本就识别不到）
- Roboflow YOLO 模型版本太旧

**Q: 一张图要识别 60+ 秒**
- 大概率是 CPU 推理，确认 GPU 已启用（`nvidia-smi` 跑得通）
- 调小 `EMBED_BATCH`（默认 8）减少单批显存占用
