# Aussie EcoLens backend

This folder contains the FastAPI-based backend that runs on AWS Lambda behind API Gateway. It exposes all RESTful APIs for upload, search, tag management, and deletion, and mediates access to Oracle NoSQL.

### Access model

EcoLens uses a **shared-access** model: every registered (authenticated) user can see, search, and tag-edit all files on the platform. **Deletion is restricted to the original uploader** — `DELETE /media` enforces an ownership check and returns a `forbidden` list for any files the caller did not upload. Notifications are equally shared — any subscriber watching a species is emailed when a matching file is uploaded by any user.

The backend is designed for:

- **Local development** as a normal FastAPI app using Uvicorn.
- **Serverless deployment** as a single Lambda function using a thin Lambda handler wrapper.

## Layout

```text
backend/
├── src/
│   ├── main.py             # FastAPI app factory and router wiring
│   ├── auth.py             # Cognito JWT validation and auth dependencies
│   ├── aws.py              # AWS SDK helpers (S3, SNS, etc.)
│   ├── config.py           # Environment and configuration loading
│   ├── notifier.py         # Tag-based notification orchestration
│   ├── repository.py       # Oracle NoSQL access layer
│   ├── schemas.py          # Pydantic request/response models
│   ├── search.py           # Query logic (tags, species, thumbnail URL, file-based)
│   ├── storage.py          # S3 presign, URL mapping, delete helpers
│   ├── tagging_handler.py  # S3 ObjectCreated handler: dedup, thumbnails, ML tagging, DB write, SNS notify
│   └── routers/            # FastAPI routers grouped by feature
│       ├── upload.py       # Presigned upload URL endpoint (POST /uploads)
│       ├── media.py        # All media operations (search, find similar, tag edit, delete)
│       └── notifications.py# Notification subscription endpoints (GET/POST/DELETE /subscriptions)
└── requirements.txt        # Python dependencies
```

## Runtime model

- **Local development**: run `src.main:app` directly with Uvicorn.
- **Lambda deployment**: API Gateway HTTP API v2 invokes the Lambda via a `$default` catch-all route. The Lambda entry-point is `backend.src.main.handler`, which is the Mangum ASGI adapter wrapping the FastAPI app. The API Lambda is deployed as a **ZIP package** (no ML model bundled); the ML processor Lambda is a separate container image.

The Lambda entrypoint is intentionally thin so there is a single implementation of the API logic for both local and cloud environments.

## Local run

```bash
cd backend
python -m pip install -r requirements.txt

# Start FastAPI locally
uvicorn src.main:app --reload
```

You can then call endpoints such as:

```
GET    /health
GET    /users/me

POST   /uploads                              initiate upload (presign + dedup)

GET    /media?tag=koala:2&tag=wombat:1       search by tag counts (AND, min count)
GET    /media?species=koala&species=dingo    search by species    (AND, count >= 1)
GET    /media/{file_id}                      resolve file_id → full-size URL
POST   /media/similar/presign                get presigned URL for reference file upload
POST   /media/similar                        find similar by pre-uploaded reference file
GET    /media/similar/result/{job_id}        poll async video similarity result
POST   /media/tags                           bulk add / remove tags
DELETE /media                                delete files, thumbnails, and DB records

GET    /subscriptions                        get current subscription (species + status)
POST   /subscriptions                        subscribe / update species-watch notifications
DELETE /subscriptions                        cancel current subscription
```

## Lambda handler

The active Lambda wrapper is defined in `backend/src/main.py` as:

```python
from mangum import Mangum

# ... app definition and route wiring ...

handler = Mangum(app)
```

The API Lambda is deployed as a **ZIP package** (no ML model). The ML processor Lambda is a **container image** (required because PyTorch exceeds the 250 MB zip limit). Both entry-points are module paths: `backend.src.main.handler` (API) and `backend.src.tagging_handler.lambda_handler` (ML processor).

## Environment variables

Key environment variables used by the backend include:

- **AWS/Cognito**:
  - `AWS_REGION`
  - `COGNITO_USER_POOL_ID`
  - `COGNITO_CLIENT_ID`

- **S3** (four separate vars):
  - `S3_UPLOAD_BUCKET` – raw user uploads (`uploads/<sha256>.<ext>`).
  - `S3_THUMBNAIL_BUCKET` – generated thumbnails (`thumbnails/<sha256>.jpg`).
  - `S3_DETECTIONS_BUCKET` – ML detection JSON (`detections/<sha256>.json`).
  - `S3_QUERY_TEMP_BUCKET` – temporary files for `POST /media/similar` reference uploads.

- **ML Lambda**:
  - `ML_LAMBDA_NAME` – function name of the ML processor Lambda, invoked asynchronously for video similarity queries.

- **CORS**:
  - `FRONTEND_ORIGIN` – CloudFront distribution URL (e.g. `https://d123abc.cloudfront.net`). Required in production; localhost is always allowed.

- **OCI NoSQL**:
  - `USE_OCI_DB=1`
  - `OCI_NOSQL_TABLE_NAME`
  - `OCI_NOSQL_COMPARTMENT_OCID`
  - `OCI_REGION`
  - `OCI_TENANCY_OCID`
  - `OCI_USER_OCID`
  - `OCI_FINGERPRINT`
  - `OCI_PRIVATE_KEY_PATH` or `OCI_PRIVATE_KEY_CONTENT`

These variables are referenced in `config.py`, `aws.py`, and `repository.py` to connect to AWS and OCI resources.

## Responsibilities vs ML pipeline

The backend has two roles:

**API Lambda** (`src/main.py` + routers): validates JWTs, issues presigned upload URLs, serves all query and admin APIs, publishes SNS subscriptions.

**ML processor Lambda** (`src/tagging_handler.py`): triggered by S3 `ObjectCreated` events on the uploads bucket. It reads the uploader's `user-id` from the S3 object metadata (`x-amz-meta-user-id`), checks for duplicate records in OCI NoSQL (and via `head_object` for the race-window case), generates a thumbnail (images), extracts 1 fps frames (videos), runs `ml_pipeline` inference, writes the metadata record (including `source_url` and `thumbnail_url`) to Oracle NoSQL, and publishes SNS tag notifications.