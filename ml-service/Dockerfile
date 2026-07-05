FROM public.ecr.aws/lambda/python:3.11

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Build tools: gcc for native extensions, cmake for onnx, mesa-libGL for opencv, git for pip deps
RUN yum install -y gcc gcc-c++ make cmake mesa-libGL git && yum clean all

# ── ML Lambda only ────────────────────────────────────────────────────────────
# This image is used exclusively by the ML Lambda (ecolens-prod-media-processor).
# The API Lambda (ecolens-prod-api-handler) is deployed as a separate ZIP package.
#
# ml-service/requirements.txt contains everything this Lambda needs:
#   - PyTorch (CPU-only), MegaDetector, torchvision, opencv, onnx2torch  (ML)
#   - boto3, pydantic-settings, oci                                       (backend runtime)
COPY ml-service/requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir --prefer-binary -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Copy ML pipeline source
COPY ml-service/src/ml_pipeline ${LAMBDA_TASK_ROOT}/ml_pipeline
# Vendored megadetector source — PyPI package 5.0.5 installs only metadata (no Python files)
COPY ml-service/src/megadetector ${LAMBDA_TASK_ROOT}/megadetector
# Copy backend source (tagging_handler, repository, catalog, storage, config, aws, etc.)
COPY backend/src ${LAMBDA_TASK_ROOT}/backend/src
COPY backend/__init__.py ${LAMBDA_TASK_ROOT}/backend/__init__.py

# Models are downloaded from S3 at cold-start by model_loader.py.
# Set as Lambda env vars: MEGADETECTOR_S3_BUCKET, MEGADETECTOR_S3_KEY,
# MODEL_S3_BUCKET, MODEL_S3_KEY — no model files baked into the image.

# Build command (run from project root):
#   docker buildx build --platform linux/amd64 --provenance=false --load \
#     -t ecolens-lambda:latest -f ml-service/Dockerfile .
#
# --platform linux/amd64  : Lambda runs x86_64
# --provenance=false       : avoid OCI manifest index that Lambda rejects
# --load                   : save image to local Docker (not just builder cache)

CMD ["backend.src.tagging_handler.lambda_handler"]
