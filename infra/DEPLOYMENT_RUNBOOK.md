# Aussie EcoLens — Deployment Runbook

## Purpose

This runbook documents repeatable manual and CLI-based deployment steps for Aussie EcoLens' cloud infrastructure. It complements the Terraform configuration (recommended) and provides:
- Console-by-console checklists with exact resource names
- Naming conventions and operator variables
- Step-by-step AWS CLI and OCI Console instructions
- Environment variable guidance for Lambda functions
- Smoke-test and verification commands
- Scripts and automation patterns for CI/CD

## Architecture Summary

- **Public edge:** AWS (S3 frontend hosting, CloudFront CDN, Cognito for authentication, API Gateway + Lambda for backend APIs, S3 media bucket for user uploads, SNS for tag-based notifications).
- **Metadata store:** Oracle Cloud Infrastructure (OCI) Oracle NoSQL for media metadata, user tags, statistics, and subscription records.
- **ML model artefacts:** Stored in the S3 models bucket (`ecolens-models-*`). The ML Lambda downloads the model at cold start via `MODEL_S3_KEY` and `MEGADETECTOR_S3_KEY` environment variables — model upgrades require no code or container changes.
- **Backend Lambda functions:** Two separate deployments:
  - **API Lambda** (`ecolens-api` / `ecolens-prod-api-handler`): deployed as a **ZIP package**. Contains only FastAPI/Mangum and lightweight dependencies; no ML model bundled.
  - **ML Lambda** (`ecolens-s3-handler` / `ecolens-prod-media-processor`): deployed as a **container image** via ECR, built from `ml-service/Dockerfile`. PyTorch + MegaDetector exceed the 250 MB ZIP limit, so a container (up to 10 GB) is required. Each Lambda's entry-point is set via `image_config.command`.

## Deployment Recommendations

- **Preferred:** Use Terraform under `infra/terraform/` for repeatable provisioning and CI/CD-driven deployment.
- **OCI credentials:** Store in AWS Secrets Manager or encrypted Lambda environment variables. Restrict access via IAM to only the Lambda roles that require it.
- **ML dependencies:** For heavy dependencies (PyTorch, etc.), prefer container images tagged with `MODEL_VERSION` over large zip files.

## Naming Conventions

Use consistent naming across AWS and OCI to simplify scripts, environment wiring, and operational tracking. Examples below use `ap-southeast-4` (recommended for Australian tenants) and `prod` as the environment; adjust as needed for `staging`, `dev`, or other regions.

### AWS Resources

- **AWS region:** `ap-southeast-4` (recommended for AU)
- **Environment:** `prod` (or `staging`, `dev`)
- **Frontend bucket:** `ecolens-<env>-frontend-<region>` (e.g., `ecolens-prod-frontend-ap-southeast-4`)
- **Media bucket:** `ecolens-<env>-media-<region>` (e.g., `ecolens-prod-media-ap-southeast-4`)
- **Model bucket:** `ecolens-<env>-models-<region>` (optional; e.g., `ecolens-prod-models-ap-southeast-4`)
- **Cognito User Pool:** `ecolens-<env>-user-pool`
- **Cognito App Client:** `ecolens-<env>-web-client`
- **API Gateway REST API:** `ecolens-<env>-api`
- **API Lambda function:** `ecolens-<env>-api-handler`
- **Media processor Lambda:** `ecolens-<env>-media-processor`
- **Tagging worker Lambda (optional):** `ecolens-<env>-tagging-worker`
- **SNS topic:** `ecolens-<env>-tags-topic`
- **CloudFront distribution:** `ecolens-<env>-cf`
- **Lambda execution role:** `ecolens-<env>-lambda-role`
- **API Gateway invoke role:** `ecolens-<env>-api-role`
- **CloudWatch log groups:** `/aws/lambda/ecolens-<env>-*`

### OCI Resources

- **OCI compartment:** `EcoLens`
- **Oracle NoSQL table:** `ECOLENS_MEDIA_METADATA`
- **OCI region:** `ap-melbourne-1` or `ap-sydney-1` (depending on tenancy)
- **OCI IAM user/group:** `ecolens-backend` or similar

## Operator Variables

Export these environment variables in your shell to make CLI steps repeatable across your deployment session. Store them together so they can be sourced from a single script.

```bash
export AWS_REGION=ap-southeast-4
export PROJECT=ecolens
export ENV=prod
export FRONTEND_BUCKET="ecolens-${ENV}-frontend-${AWS_REGION}"
export MEDIA_BUCKET="ecolens-${ENV}-media-${AWS_REGION}"
export THUMBNAIL_BUCKET="ecolens-${ENV}-thumbnails-${AWS_REGION}"
export DETECTIONS_BUCKET="ecolens-${ENV}-detections-${AWS_REGION}"
export QUERY_TEMP_BUCKET="ecolens-${ENV}-query-temp-${AWS_REGION}"
export MODEL_BUCKET="ecolens-${ENV}-models-${AWS_REGION}"
export USER_POOL_NAME="ecolens-${ENV}-user-pool"
export APP_CLIENT_NAME="ecolens-${ENV}-web-client"
export API_NAME="ecolens-${ENV}-api"
export MEDIA_PROCESSOR_NAME="ecolens-${ENV}-media-processor"
export TAGGING_WORKER_NAME="ecolens-${ENV}-tagging-worker"
export OCI_COMPARTMENT_NAME=EcoLens
export OCI_TABLE_NAME=ECOLENS_MEDIA_METADATA
```

Save this to a file (e.g., `deploy-vars.sh`) and source it at the start of each deployment session:

```bash
source deploy-vars.sh
```

---

## Console-by-Console Deployment Checklist

Use this order when setting up the project manually from blank infrastructure. Complete all AWS resources first, then OCI resources, then wire them together.

### AWS Console Setup

Follow these steps in the **AWS Console** to provision the minimum required resources:

#### 1. Create S3 Buckets

Create six buckets with the naming convention above:
- **Uploads bucket** — raw user media (browsers upload via presigned URLs; `ObjectCreated` triggers the ML Lambda)
- **Thumbnails bucket** — image thumbnails generated by the ML Lambda
- **Detections bucket** — raw MegaDetector detection JSON per file
- **Models bucket** — versioned MegaDetector and species-classifier weight files
- **Frontend bucket** — compiled React SPA (served through CloudFront only)
- **Query-temp bucket** — ephemeral scratch space for query-by-file reference uploads (files deleted immediately after ML processing; never stored in the database)

For each bucket, apply these configurations:

##### 1a. Enable Versioning

Enable versioning on exactly these three buckets. Do **not** enable it on thumbnails or detections (they are regenerated automatically and versioning wastes storage).

| Bucket | Enable versioning? | Reason |
|---|---|---|
| Uploads | **Yes** | Protects original user media from accidental deletion or overwrite |
| Frontend | **Yes** | Allows instant rollback if a bad frontend build is deployed |
| Models | **Yes** | Preserves every model version so you can roll back without a code change (satisfies requirement 4.1.1) |
| Thumbnails | No | Auto-generated; can be recreated from originals |
| Detections | No | Auto-generated ML output; can be reprocessed |
| Query-temp | No | Ephemeral; files are deleted immediately after use |

For each of the three buckets above: go to the bucket > **Properties** > **Bucket Versioning** > **Edit** > select **Enable** > **Save changes**.

##### 1b. Enable Default Encryption
- Go to each bucket > **Properties** > **Default encryption** > **Edit**.
- Choose **Server-side encryption with Amazon S3-managed keys (SSE-S3)** or **AWS KMS keys (SSE-KMS)** if you have a KMS key policy.
- Save.

##### 1c. Configure CORS for the Media Bucket
- Go to the media bucket > **Permissions** > **Cross-origin resource sharing (CORS)**.
- Add a policy to allow the frontend to upload via presigned URLs:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedOrigins": ["https://<your-frontend-domain>", "http://localhost:5173"],
    "ExposeHeaders": ["ETag", "x-amz-version-id"],
    "MaxAgeSeconds": 3000
  }
]
```

Replace `<your-frontend-domain>` with the actual frontend CloudFront or S3 domain once known. During development, include `http://localhost:*`.

#### 2. Create Cognito User Pool

- Go to **Cognito** > **User Pools** > **Create user pool**.
- Configure:
  - **Cognito user pool sign-in options:** Email (required).
  - **Multi-factor authentication (MFA):** Optional (recommended: "No MFA" for quick setup, "Optional MFA" or "Required MFA" for production).
  - **User account recovery options:** Email (recommended).
  - **Self-service account recovery:** Enable.
- Under **Standard attributes:**
  - Required: `email`
  - Optional: `given_name`, `family_name`, `phone_number`
- Under **Custom attributes (optional):** Add any project-specific attributes (e.g., `organization`, `role`).
- Review and **Create user pool**.
- Copy the **User Pool ID** (e.g., `ap-southeast-4_aBcDeFgHi`).

#### 2a. Create Cognito App Client

- Go to your User Pool > **App clients** (under **Integrations**) > **Create app client**.
- Configure:
  - **App client name:** `ecolens-prod-web-client`
  - **Client type:** Public client
  - **Authentication flows:** Select "ALLOW_USER_PASSWORD_AUTH" and "ALLOW_REFRESH_TOKEN_AUTH" (or use OAuth 2.0 authorization code flow for better security).
  - **Allowed callback URLs:** `https://<your-frontend-domain>/dashboard`, `http://localhost:5173/dashboard`
  - **Allowed sign-out URLs:** `https://<your-frontend-domain>/login`, `http://localhost:5173/login`
  - **Allowed OAuth Scopes:** `openid`, `profile`, `email`
- Review and **Create app client**.
- Copy the **Client ID** (e.g., `1a2b3c4d5e6f7g8h9i0j1k2l`).

#### 3. Create IAM Roles for Lambda Functions

Create at least one Lambda execution role with least-privilege permissions. You can reuse it for all Lambdas or create separate roles per function for tighter isolation.

- Go to **IAM** > **Roles** > **Create role**.
- **Trusted entity type:** AWS Lambda.
- **Permissions policies:** Attach or create inline policies for:

##### 3a. CloudWatch Logs (required for all Lambdas)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-southeast-4:*:*"
    }
  ]
}
```

##### 3b. S3 Access (for media and model buckets)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::ecolens-prod-media-ap-southeast-4",
        "arn:aws:s3:::ecolens-prod-media-ap-southeast-4/*",
        "arn:aws:s3:::ecolens-prod-thumbnails-ap-southeast-4",
        "arn:aws:s3:::ecolens-prod-thumbnails-ap-southeast-4/*",
        "arn:aws:s3:::ecolens-prod-detections-ap-southeast-4",
        "arn:aws:s3:::ecolens-prod-detections-ap-southeast-4/*",
        "arn:aws:s3:::ecolens-prod-models-ap-southeast-4",
        "arn:aws:s3:::ecolens-prod-models-ap-southeast-4/*",
        "arn:aws:s3:::ecolens-prod-query-temp-ap-southeast-4",
        "arn:aws:s3:::ecolens-prod-query-temp-ap-southeast-4/*"
      ]
    }
  ]
}
```

##### 3c. SNS (for tag notifications and subscription management)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:SetSubscriptionAttributes",
        "sns:GetSubscriptionAttributes",
        "sns:ListSubscriptionsByTopic"
      ],
      "Resource": "arn:aws:sns:ap-southeast-4:*:ecolens-prod-tags-topic"
    }
  ]
}
```

##### 3d. Secrets Manager / SSM (for OCI credentials)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "ssm:GetParameter"
      ],
      "Resource": [
        "arn:aws:secretsmanager:ap-southeast-4:*:secret:ecolens/oci/*",
        "arn:aws:ssm:ap-southeast-4:*:parameter/ecolens/oci/*"
      ]
    }
  ]
}
```

- **Role name:** `ecolens-prod-lambda-role`
- Review and **Create role**.

#### 4. Create Lambda Functions

The two Lambda functions use **different deployment packages**:
- **API Lambda** (`ecolens-prod-api-handler`) — deployed as a **ZIP package** (FastAPI/Mangum only; no ML model).
- **ML Lambda** (`ecolens-prod-media-processor`) — deployed as a **container image** from ECR (PyTorch + MegaDetector exceed the 250 MB ZIP limit).

Build and push the container image first, then create each function.

##### 4a. Create ECR Repository and Push Image

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ecolens-prod-lambda"

# Create repository
aws ecr create-repository --repository-name "ecolens-prod-lambda" --region "$AWS_REGION"

# Authenticate and push
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REPO"

# Build from project root (Dockerfile is in ml-service/)
docker build --platform linux/amd64 -t "$ECR_REPO:latest" -f ml-service/Dockerfile .
docker push "$ECR_REPO:latest"
```

> **IAM note:** Grant the Lambda role ECR pull permissions (`ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `ecr:GetAuthorizationToken`) so Lambda can pull the image at cold-start.

##### 4b. API Handler Lambda (`ecolens-prod-api-handler`)

- Go to **Lambda** > **Create function** > **Author from scratch**.
- **Function name:** `ecolens-prod-api-handler`
- **Runtime:** Python 3.11
- **Architecture:** `x86_64`
- **Execution role:** `ecolens-prod-lambda-role` (from step 3)
- **Timeout:** 300 seconds
- **Memory:** 1024 MB
- **Handler:** `backend.src.main.handler` (Mangum ASGI adapter entry-point)
- **Package type:** `Zip` — upload the backend ZIP package (no ML model; lightweight FastAPI/Mangum only).

##### 4c. Media Processor Lambda (`ecolens-prod-media-processor`)

- Go to **Lambda** > **Create function** > **Container image**.
- **Function name:** `ecolens-prod-media-processor`
- **Container image URI:** `<account-id>.dkr.ecr.<region>.amazonaws.com/ecolens-prod-lambda:latest`
- **Execution role:** `ecolens-prod-lambda-role`
- **Timeout:** 300 seconds
- **Memory:** 3008 MB (MegaDetector requires ~2.5 GB RAM)
- **Image override — CMD:** `backend.src.tagging_handler.lambda_handler`

#### 5. Create SNS Topic

- Go to **SNS** > **Topics** > **Create topic**.
- **Topic name:** `ecolens-prod-tags-topic`
- **Display name:** `EcoLens Tag Notifications`
- **Encryption:** Optional (recommended for production: enable KMS encryption).
- **Create topic**.
- Copy the **Topic ARN** (e.g., `arn:aws:sns:ap-southeast-4:123456789012:ecolens-prod-tags-topic`).

#### 6. Create API Gateway HTTP API v2

- Go to **API Gateway** > **APIs** > **Create API** > choose **HTTP API** > **Build**.
- **API name:** `ecolens-prod-api`
- **Integration:** Add a Lambda integration pointing to `ecolens-prod-api-handler`.
- **Routes:** Use a single `$default` catch-all route — Mangum/FastAPI handles all routing internally.
- **CORS:** Configure the built-in CORS block (no MOCK integrations needed):
  - `Allow-Headers: authorization,content-type`
  - `Allow-Methods: GET,POST,DELETE,OPTIONS`
  - `Allow-Origin: <your-frontend-cloudfront-url>`
- **Authorizer:** Add a JWT authorizer using the Cognito User Pool issuer URL and app client ID. The Lambda also validates JWTs internally, so gateway auth is defence-in-depth.
- **Stage:** Use the auto-created `$default` stage (no stage name in the URL).
- Copy the **invoke URL** (format: `https://<api-id>.execute-api.<region>.amazonaws.com` — **no `/prod` suffix**).

#### 7. Wire S3 ObjectCreated Events to Media Processor Lambda

- Go to the media bucket > **Event notifications** > **Create event notification**.
- **Event name:** `trigger-media-processor`
- **Event types:** Select `s3:ObjectCreated:*` (and optionally `s3:ObjectRemoved:*` for deletion).
- **Destination:** Lambda function > select `ecolens-prod-media-processor`.
- **Create event notification**.

#### 8. Create CloudFront Distribution (Optional but Recommended)

- Go to **CloudFront** > **Distributions** > **Create distribution**.
- **Origin domain:** Your frontend S3 bucket (e.g., `ecolens-prod-frontend-ap-southeast-4.s3.ap-southeast-4.amazonaws.com`).
- **S3 access:** Use **Origin access control** to restrict bucket access to CloudFront only.
- **Default cache behavior:**
  - **Viewer protocol policy:** Redirect HTTP to HTTPS
  - **Cache key and origin requests:** Use cache policy `CachingOptimized` and origin request policy `AllViewerExceptHostHeader`.
- **Alternate domain names (optional):** Add your custom domain if using Route 53 or external DNS.
- **Default root object:** `index.html`
- **Error pages (optional):** Set error code 404 to respond with `/index.html` (for SPA routing).
- Review and **Create distribution**.
- Copy the **Distribution domain name** (e.g., `d123abc.cloudfront.net`).

### OCI Console Setup

Complete these steps in the **OCI Console** to provision the metadata store.

#### 1. Create Compartment

- Go to **Identity & Security** > **Compartments** > **Create Compartment**.
- **Name:** `EcoLens`
- **Description:** `Metadata store and backend services for Aussie EcoLens`
- **Create Compartment**.

#### 2. Create Oracle NoSQL Table

- Go to **Oracle NoSQL** > **Tables** > **Create table** (ensure you're in the `EcoLens` compartment).
- **Table name:** `ECOLENS_MEDIA_METADATA`
- **Column definitions:** Define columns per your schema (e.g., `id`, `s3_key`, `created_at`, `tags`, `metadata`, etc.). See [backend/src/schemas.py](../../backend/src/schemas.py) for the current schema definition.
- **Throughput capacity (optional):** Set read/write units based on expected load. Start with 100 RU / 100 WU for testing.
- **Create table**.
- Copy the **Table name**, **OCID**, and **Compartment OCID** once created.

#### 3. Create OCI IAM User and Generate API Key

- Go to **Identity & Security** > **Users** > **Create user**.
- **Name:** `ecolens-backend`
- **Description:** Backend service account for Aussie EcoLens
- **Create**.
- Go to the user > **API keys** > **Add API key**.
- **Key type:** Generate a new API signing key pair.
- **Download private key** and save securely (you'll reference this in Lambda env vars).
- Copy the **Fingerprint** from the key details page.

#### 4. Create IAM Group and Attach Policy

- Go to **Identity & Security** > **Groups** > **Create group**.
- **Name:** `ecolens-backend-group`
- **Add members:** Select the `ecolens-backend` user.
- **Create group**.
- Go to the group > **Policies** > **Create policy**.
- **Name:** `ecolens-backend-nosql-policy`
- **Compartment:** Select the `EcoLens` compartment.
- **Policy statements:** Add a policy to grant NoSQL access:

```
Allow group ecolens-backend-group to manage nosql-tables in compartment EcoLens
Allow group ecolens-backend-group to read compartments in tenancy
```

- **Create**.

#### 5. Gather OCI Details

For Lambda environment variables, retrieve and record:
1. Go to **Profile** > **Tenancy information** > copy **Tenancy OCID** (e.g., `ocid1.tenancy.oc1..aaaa...`)
2. Go to **Profile** > **User settings** > copy your **User OCID** (e.g., `ocid1.user.oc1..aaa...`)
3. From the API key created in step 3, copy the **Fingerprint** (e.g., `7d:fa:83:ff:ce:61:...`)
4. Find your OCI region name (e.g., `ap-melbourne-1` or `ap-sydney-1`) from the region dropdown at the top-right of the console.
5. From the NoSQL table created in step 2, copy the **Compartment OCID** and **Table OCID**.

---

## Minimal AWS CLI + OCI Console Runbook

This is the fastest deployment path if you prefer CLI scripting for AWS while using OCI Console for setup.

### Step 0: Set Operator Variables

```bash
source deploy-vars.sh
```

### Step 1: Create S3 Buckets

```bash
# Create buckets
for BUCKET in "$MEDIA_BUCKET" "$THUMBNAIL_BUCKET" "$DETECTIONS_BUCKET" "$MODEL_BUCKET" "$FRONTEND_BUCKET" "$QUERY_TEMP_BUCKET"; do
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION"
  echo "Created: $BUCKET"
done

# Enable versioning on uploads, frontend, and models only.
# Thumbnails, detections, and query-temp are auto-generated or ephemeral — versioning not needed.
for BUCKET in "$MEDIA_BUCKET" "$FRONTEND_BUCKET" "$MODEL_BUCKET"; do
  aws s3api put-bucket-versioning \
    --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled
  echo "Versioning enabled: $BUCKET"
done

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket "$MEDIA_BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'

# Apply CORS policy to media bucket
aws s3api put-bucket-cors \
  --bucket "$MEDIA_BUCKET" \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST"],
        "AllowedOrigins": ["https://<your-frontend-domain>", "http://localhost:5173"],
        "ExposeHeaders": ["ETag", "x-amz-version-id"],
        "MaxAgeSeconds": 3000
      }
    ]
  }'
```

### Step 2: Create Cognito User Pool and App Client

```bash
# Create User Pool
USER_POOL_ID=$(aws cognito-idp create-user-pool \
  --pool-name "$USER_POOL_NAME" \
  --policies PasswordPolicy='{MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true}' \
  --auto-verified-attributes "['email']" \
  --schema Name='email',AttributeDataType='String',Required=true Name='given_name',AttributeDataType='String' Name='family_name',AttributeDataType='String' \
  --region "$AWS_REGION" \
  --query 'UserPool.Id' \
  --output text)

echo "User Pool ID: $USER_POOL_ID"

# Create App Client
APP_CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-name "$APP_CLIENT_NAME" \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --allowed-o-auth-flows code implicit \
  --allowed-o-auth-scopes openid profile email \
  --region "$AWS_REGION" \
  --query 'UserPoolClient.ClientId' \
  --output text)

echo "App Client ID: $APP_CLIENT_ID"
```

### Step 3: Create IAM Role for Lambdas

```bash
# Create the role
ROLE_ARN=$(aws iam create-role \
  --role-name "ecolens-prod-lambda-role" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "lambda.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }' \
  --query 'Role.Arn' \
  --output text)

echo "Role ARN: $ROLE_ARN"

# Attach basic Lambda execution policy
aws iam attach-role-policy \
  --role-name "ecolens-prod-lambda-role" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

# Attach S3 policy
aws iam put-role-policy \
  --role-name "ecolens-prod-lambda-role" \
  --policy-name "s3-access" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ],
        "Resource": [
          "arn:aws:s3:::'"$MEDIA_BUCKET"'",
          "arn:aws:s3:::'"$MEDIA_BUCKET"'/*",
          "arn:aws:s3:::'"$THUMBNAIL_BUCKET"'",
          "arn:aws:s3:::'"$THUMBNAIL_BUCKET"'/*",
          "arn:aws:s3:::'"$DETECTIONS_BUCKET"'",
          "arn:aws:s3:::'"$DETECTIONS_BUCKET"'/*",
          "arn:aws:s3:::'"$MODEL_BUCKET"'",
          "arn:aws:s3:::'"$MODEL_BUCKET"'/*",
          "arn:aws:s3:::'"$QUERY_TEMP_BUCKET"'",
          "arn:aws:s3:::'"$QUERY_TEMP_BUCKET"'/*"
        ]
      }
    ]
  }'

# Attach SNS policy
aws iam put-role-policy \
  --role-name "ecolens-prod-lambda-role" \
  --policy-name "sns-publish" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "sns:Publish",
        "Resource": "arn:aws:sns:'"$AWS_REGION"':*:ecolens-prod-tags-topic"
      }
    ]
  }'

# Sleep to allow IAM to propagate
sleep 10
```

### Step 4: Build Container Image and Create Lambda Functions

Both Lambdas use the same ECR container image. Build and push it first, then create each function.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ecolens-prod-lambda"

# Create ECR repository
aws ecr create-repository --repository-name "ecolens-prod-lambda" --region "$AWS_REGION"

# Add ECR pull permissions to the Lambda role
aws iam put-role-policy \
  --role-name "ecolens-prod-lambda-role" \
  --policy-name "ecr-pull" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    }]
  }'

# Authenticate Docker to ECR
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REPO"

# Build from project root (Dockerfile is in ml-service/)
docker build --platform linux/amd64 -t "$ECR_REPO:latest" \
  -f ml-service/Dockerfile .
docker push "$ECR_REPO:latest"

# Create the API Lambda — ZIP package (no ML model, lightweight FastAPI/Mangum only)
aws lambda create-function \
  --function-name "ecolens-prod-api-handler" \
  --package-type Zip \
  --zip-file fileb://lambda.zip \
  --handler "backend.src.main.handler" \
  --runtime python3.11 \
  --role "arn:aws:iam::$ACCOUNT_ID:role/ecolens-prod-lambda-role" \
  --timeout 300 \
  --memory-size 1024 \
  --region "$AWS_REGION"

# Create the Media Processor Lambda — container image (PyTorch requires container deployment)
aws lambda create-function \
  --function-name "ecolens-prod-media-processor" \
  --package-type Image \
  --code ImageUri="$ECR_REPO:latest" \
  --image-config '{"Command":["backend.src.tagging_handler.lambda_handler"]}' \
  --role "arn:aws:iam::$ACCOUNT_ID:role/ecolens-prod-lambda-role" \
  --timeout 300 \
  --memory-size 3008 \
  --region "$AWS_REGION"
```

### Step 5: Create SNS Topic

```bash
SNS_TOPIC_ARN=$(aws sns create-topic \
  --name "ecolens-prod-tags-topic" \
  --region "$AWS_REGION" \
  --query 'TopicArn' \
  --output text)

echo "SNS Topic ARN: $SNS_TOPIC_ARN"
```

### Step 6: Create API Gateway HTTP API v2

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
LAMBDA_ARN="arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:ecolens-prod-api-handler"

# Create HTTP API with built-in CORS (no manual OPTIONS routes needed)
API_ID=$(aws apigatewayv2 create-api \
  --name "ecolens-prod-api" \
  --protocol-type HTTP \
  --cors-configuration "AllowOrigins=$FRONTEND_ORIGIN,AllowMethods=GET,POST,DELETE,OPTIONS,AllowHeaders=authorization,content-type,AllowCredentials=false" \
  --region "$AWS_REGION" \
  --query 'ApiId' --output text)
echo "API ID: $API_ID"

# Create Lambda integration (payload format 2.0 is required for Mangum)
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$LAMBDA_ARN" \
  --payload-format-version "2.0" \
  --region "$AWS_REGION" \
  --query 'IntegrationId' --output text)

# $default catch-all route — Mangum/FastAPI handles all routing internally
aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key '$default' \
  --target "integrations/$INTEGRATION_ID" \
  --region "$AWS_REGION"

# Auto-deploy $default stage
aws apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name '$default' \
  --auto-deploy \
  --region "$AWS_REGION"

# Allow API Gateway to invoke the Lambda
aws lambda add-permission \
  --function-name "ecolens-prod-api-handler" \
  --statement-id "AllowAPIGatewayV2Invoke" \
  --action "lambda:InvokeFunction" \
  --principal "apigateway.amazonaws.com" \
  --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*" \
  --region "$AWS_REGION"

# Invoke URL — no stage suffix for $default stage
API_ENDPOINT="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com"
echo "API Endpoint: $API_ENDPOINT"
```

### Step 7: Wire S3 Events to Media Processor

```bash
# Add Lambda permission for S3
aws lambda add-permission \
  --function-name "ecolens-prod-media-processor" \
  --statement-id "AllowS3Invoke" \
  --action "lambda:InvokeFunction" \
  --principal "s3.amazonaws.com" \
  --source-arn "arn:aws:s3:::$MEDIA_BUCKET" \
  --region "$AWS_REGION"

# Create S3 event notification
aws s3api put-bucket-notification-configuration \
  --bucket "$MEDIA_BUCKET" \
  --notification-configuration '{
    "LambdaFunctionConfigurations": [
      {
        "LambdaFunctionArn": "arn:aws:lambda:'"$AWS_REGION"':$(aws sts get-caller-identity --query Account --output text):function:ecolens-prod-media-processor",
        "Events": ["s3:ObjectCreated:*"]
      }
    ]
  }'
```

### Step 8: Set Lambda Environment Variables

Both Lambda functions (API handler and media processor) share the same environment. Variable names must match `backend/src/config.py` exactly. Note `COGNITO_CLIENT_ID` (not `COGNITO_APP_CLIENT_ID`) and the three separate S3 bucket vars (not a single `S3_BUCKET`).

```bash
SHARED_ENV="Variables={
  AWS_REGION=$AWS_REGION,
  S3_UPLOAD_BUCKET=$MEDIA_BUCKET,
  S3_THUMBNAIL_BUCKET=$THUMBNAIL_BUCKET,
  S3_DETECTIONS_BUCKET=$DETECTIONS_BUCKET,
  S3_QUERY_TEMP_BUCKET=$QUERY_TEMP_BUCKET,
  ML_LAMBDA_NAME=ecolens-prod-media-processor,
  COGNITO_USER_POOL_ID=$USER_POOL_ID,
  COGNITO_CLIENT_ID=$APP_CLIENT_ID,
  SNS_TOPIC_ARN=$SNS_TOPIC_ARN,
  FRONTEND_ORIGIN=$FRONTEND_ORIGIN,
  USE_OCI_DB=1,
  OCI_NOSQL_TABLE_NAME=$OCI_TABLE_NAME,
  OCI_NOSQL_COMPARTMENT_OCID=<OCID>,
  OCI_NOSQL_ENDPOINT=<OCI_NOSQL_ENDPOINT>,
  OCI_REGION=ap-melbourne-1,
  OCI_TENANCY_OCID=<OCID>,
  OCI_USER_OCID=<OCID>,
  OCI_FINGERPRINT=<FINGERPRINT>,
  OCI_PRIVATE_KEY_CONTENT=<PEM_KEY_CONTENT_INLINE>,
  MODEL_S3_BUCKET=$MODEL_BUCKET,
  MODEL_S3_KEY=models/mdv5a.pt,
  MODEL_VERSION=v1.0.0
}"
# Note: S3_QUERY_TEMP_BUCKET and ML_LAMBDA_NAME are only used by the API Lambda.
# MODEL_* vars are only used by the Media Processor Lambda.
# Set env vars separately per Lambda if you want strict separation.

# API Lambda
aws lambda update-function-configuration \
  --function-name "ecolens-prod-api-handler" \
  --environment "$SHARED_ENV" \
  --region "$AWS_REGION"

# Media Processor Lambda (same vars; also needs SNS + model vars for tagging)
aws lambda update-function-configuration \
  --function-name "ecolens-prod-media-processor" \
  --environment "$SHARED_ENV" \
  --region "$AWS_REGION"
```

### Step 9: Build and Deploy Frontend

```bash
cd frontend

# Install dependencies
npm install

# Build with API base URL
VITE_API_BASE_URL="$API_ENDPOINT" npm run build

# Sync to S3
aws s3 sync dist/ "s3://$FRONTEND_BUCKET/" --delete --region "$AWS_REGION"

# Invalidate CloudFront (if using CloudFront)
# DISTRIBUTION_ID="<your-distribution-id>"
# aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"
```

---

## API Gateway Routes

The backend is a FastAPI/Mangum application deployed behind an HTTP API v2 `$default` catch-all route. API Gateway forwards all requests to the Lambda; Mangum translates the event to ASGI and FastAPI handles all routing internally. The invoke URL has **no stage suffix** (e.g. `https://<id>.execute-api.<region>.amazonaws.com`).

RESTful endpoints served by the backend:

| Method | Path                          | Auth     | Purpose                                           |
|--------|-------------------------------|----------|---------------------------------------------------|
| GET    | /health                       | None     | Public health probe                               |
| GET    | /users/me                     | Required | Echo authenticated user (JWT smoke test)          |
| POST   | /uploads                      | Required | Two-layer dedup check + presigned S3 PUT URL      |
| GET    | /media?tag=koala:2&tag=wombat:1 | Required | Search by tag counts (AND, min count per species) |
| GET    | /media?species=koala          | Required | Search by species (count ≥ 1 each, AND)           |
| GET    | /media/{file_id}              | Required | Resolve file_id → full-size URL                   |
| POST   | /media/similar/presign        | Required | Get presigned S3 PUT URL for reference file upload |
| POST   | /media/similar                | Required | Find similar (sync for images; 202 + job_id for videos) |
| GET    | /media/similar/result/{job_id}| Required | Poll async video similarity result                |
| POST   | /media/tags                   | Required | Bulk add/remove tags (operation 1=add, 0=remove; any user) |
| DELETE | /media                        | Required | Delete files, thumbnails, DB records (owner only) |
| GET    | /subscriptions                | Required | Get current SNS subscription details              |
| POST   | /subscriptions                | Required | Subscribe / update species-watch notifications    |
| DELETE | /subscriptions                | Required | Cancel current SNS subscription                   |
---

## Environment Variables for Lambda Functions

Set these environment variables on all Lambda functions via the AWS Console or CLI. Substitute placeholder values with actual OCIDs and credentials.

Variable names must match exactly — they map directly to `backend/src/config.py` (`Settings` class, case-insensitive).

```
# AWS / region
AWS_REGION=ap-southeast-4

# S3 buckets — six separate buckets, all required
S3_UPLOAD_BUCKET=ecolens-prod-media-ap-southeast-4
S3_THUMBNAIL_BUCKET=ecolens-prod-thumbnails-ap-southeast-4
S3_DETECTIONS_BUCKET=ecolens-prod-detections-ap-southeast-4
S3_QUERY_TEMP_BUCKET=ecolens-prod-query-temp-ap-southeast-4

# Cognito — must match the user pool and app client created in step 2
COGNITO_USER_POOL_ID=ap-southeast-4_aBcDeFgHi
COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l

# OCI NoSQL — set USE_OCI_DB=1 or the backend falls back to a local JSON file
# which is read-only in Lambda and will crash on any write
USE_OCI_DB=1
OCI_NOSQL_TABLE_NAME=ECOLENS_MEDIA_METADATA
OCI_NOSQL_COMPARTMENT_OCID=ocid1.compartment.oc1..aaaaaaaasyqu5pdcdol3jlvltcmq3znppcwj5v6tbtj6zjs7ushrkggpbsrq
OCI_REGION=ap-melbourne-1
OCI_TENANCY_OCID=ocid1.tenancy.oc1..aaaaaaaaiyyi3nbobwukntd3wau3iwdevln6ybdjxs2drbuemttt6ve3xwka
OCI_USER_OCID=ocid1.user.oc1..aaaaaaaapyqlo44f7xzwgwhmqdzvrv6rzvw2t5d4idcnm5thfvj5nxi4gy3a
OCI_FINGERPRINT=7d:fa:83:ff:ce:61:74:c7:18:3e:fa:20:e9:4a:83:ff
OCI_PRIVATE_KEY_CONTENT=<paste PEM key content inline — use OCI_PRIVATE_KEY_CONTENT not a file path>

# SNS — required for tag-based email notifications (section 4.4)
# Without this, subscribe and publish calls are silently skipped
SNS_TOPIC_ARN=arn:aws:sns:ap-southeast-4:123456789012:ecolens-prod-tags-topic

# CORS — set to the CloudFront distribution URL once known (step 8 output)
# Without this, browsers will block all API calls from the deployed frontend
FRONTEND_ORIGIN=https://d123abc.cloudfront.net

# ML model artefacts
MODEL_S3_BUCKET=ecolens-prod-models-ap-southeast-4
MODEL_S3_KEY=models/mdv5a.pt
MODEL_LABELS_S3_BUCKET=ecolens-prod-models-ap-southeast-4
MODEL_LABELS_S3_KEY=models/labels.txt
MEGADETECTOR_S3_BUCKET=ecolens-prod-models-ap-southeast-4
MEGADETECTOR_S3_KEY=models/megadetector.pt
MODEL_VERSION=v1.0.0
```

---

## Smoke Test (End-to-End Validation)

After deployment, run this smoke test to verify the complete workflow:

1. **Sign in via Cognito:**
   ```bash
   # Open the frontend in a browser and sign in
   # Or use AWS CLI to get a token
   aws cognito-idp admin-initiate-auth \
     --user-pool-id "$USER_POOL_ID" \
     --client-id "$APP_CLIENT_ID" \
     --auth-flow ADMIN_USER_PASSWORD_AUTH \
     --auth-parameters USERNAME=test@example.com,PASSWORD=TestPassword123! \
     --region "$AWS_REGION"
   ```

2. **Request a presigned upload URL:**
   ```bash
   curl -X POST "$API_ENDPOINT/uploads" \
     -H "Authorization: Bearer <idToken>" \
     -H "Content-Type: application/json" \
     -d '{
       "filename": "test.jpg",
       "checksum": "<sha256-of-file>",
       "content_type": "image/jpeg"
     }'
   ```

3. **Upload a test image:**
   ```bash
   # Use the presigned URL returned above; also send x-amz-meta-user-id header
   curl -X PUT "<presigned-url>" \
     -H "Content-Type: image/jpeg" \
     -H "x-amz-meta-user-id: <user-id>" \
     --data-binary @test-image.jpg
   ```

4. **Verify Lambda execution:**
   - Check CloudWatch Logs for the media processor Lambda (`/aws/lambda/ecolens-prod-media-processor`).
   - Confirm the Lambda executed successfully and processed the image.

5. **Verify metadata in OCI NoSQL:**
   - Go to the OCI Console > Oracle NoSQL > Tables > `ECOLENS_MEDIA_METADATA`.
   - Check that a new record was created with the uploaded image's metadata and tags.

6. **Test API endpoints:**
   ```bash
   # Health check (unauthenticated)
   curl "$API_ENDPOINT/health"

   # Echo authenticated user (confirm JWT is accepted)
   curl "$API_ENDPOINT/users/me" -H "Authorization: Bearer <idToken>"

   # Search by tag counts — AND logic, e.g. >=2 koalas AND >=1 wombat
   curl "$API_ENDPOINT/media?tag=koala:2&tag=wombat:1" \
     -H "Authorization: Bearer <idToken>"

   # Search by species (count >= 1 each)
   curl "$API_ENDPOINT/media?species=dingo" \
     -H "Authorization: Bearer <idToken>"

   # Resolve file_id to full-size URL
   curl "$API_ENDPOINT/media/<file_id>" \
     -H "Authorization: Bearer <idToken>"

   # Find similar by uploading a reference file
   curl -X POST "$API_ENDPOINT/media/similar" \
     -H "Authorization: Bearer <idToken>" \
     -F "file=@test-image.jpg"

   # Subscribe to notifications
   curl -X POST "$API_ENDPOINT/subscriptions" \
     -H "Authorization: Bearer <idToken>" \
     -H "Content-Type: application/json" \
     -d '{"species": ["koala", "wombat"], "email": "user@example.com"}'

   # Bulk tag edit (operation 1=add, 0=remove)
   curl -X POST "$API_ENDPOINT/media/tags" \
     -H "Authorization: Bearer <idToken>" \
     -H "Content-Type: application/json" \
     -d '{"urls": ["https://..."], "tags": ["kangaroo"], "operation": 1}'

   # Delete files (JSON body on DELETE)
   curl -X DELETE "$API_ENDPOINT/media" \
     -H "Authorization: Bearer <idToken>" \
     -H "Content-Type: application/json" \
     -d '{"urls": ["https://..."]}'
   ```

7. **Verify email notifications (optional):**
   - Check your email for SNS subscription confirmation and tag alerts.

---

## Quick Verification Commands

Use these commands to confirm the deployment is wired correctly:

```bash
# S3 buckets
aws s3 ls "s3://$FRONTEND_BUCKET" --region "$AWS_REGION"
aws s3 ls "s3://$MEDIA_BUCKET" --region "$AWS_REGION"
aws s3 ls "s3://$MODEL_BUCKET" --region "$AWS_REGION"

# Lambda functions
aws lambda list-functions --region "$AWS_REGION" | grep ecolens-prod

# API Gateway REST API
aws apigateway get-rest-apis --region "$AWS_REGION"

# Cognito
aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" --region "$AWS_REGION"

# S3 events
aws s3api get-bucket-notification-configuration --bucket "$MEDIA_BUCKET" --region "$AWS_REGION"
```

---

## Common Troubleshooting

### Lambda Execution Errors

1. **Check CloudWatch Logs:**
   ```bash
   aws logs tail /aws/lambda/ecolens-prod-api-handler --follow --region "$AWS_REGION"
   aws logs tail /aws/lambda/ecolens-prod-media-processor --follow --region "$AWS_REGION"
   ```

2. **Common issues:**
   - **Module not found:** Verify the container image was built and pushed to ECR correctly and that the `image_config.command` matches the module path (`backend.src.main.handler` for the API Lambda, `backend.src.tagging_handler.lambda_handler` for the media processor).
   - **Timeout:** Increase Lambda timeout and memory (esp. for ML inference).
   - **OCI connection error:** Verify OCI credentials (OCID, fingerprint, private key) and network connectivity.

### S3 Event Notifications Not Triggering

1. **Verify S3 permissions:**
   ```bash
   aws s3api get-bucket-notification-configuration --bucket "$MEDIA_BUCKET" --region "$AWS_REGION"
   ```

2. **Verify Lambda permissions:**
   ```bash
   aws lambda get-policy --function-name ecolens-prod-media-processor --region "$AWS_REGION"
   ```

3. **Re-add S3 trigger if missing:**
   ```bash
   aws lambda add-permission \
     --function-name ecolens-prod-media-processor \
     --statement-id AllowS3Invoke \
     --action lambda:InvokeFunction \
     --principal s3.amazonaws.com \
     --source-arn "arn:aws:s3:::$MEDIA_BUCKET" \
     --region "$AWS_REGION"
   ```

### OCI NoSQL Connection Issues

1. **Test OCI credentials locally:**
   ```bash
   python3 -c "
   from oci import config, nosql
   
   cfg = config.from_file()
   client = nosql.NosqlClient(cfg)
   # Attempt a simple query
   print('OCI connection successful')
   "
   ```

2. **Verify compartment and table names:**
   ```bash
   oci nosql table list --compartment-id "$OCI_COMPARTMENT_ID" --region "$OCI_REGION"
   ```

### API Gateway CORS Errors

HTTP API v2 has a built-in `cors_configuration` block — no MOCK integrations or manual `OPTIONS` routes are needed. CORS is handled two ways:
1. The HTTP API v2 CORS block sets `Access-Control-Allow-*` headers on all responses including preflight.
2. The FastAPI `CORSMiddleware` in the backend also sets these headers as a defence-in-depth fallback.

1. **Verify CORS configuration on the API:**
   ```bash
   aws apigatewayv2 get-api --api-id "$API_ID" --region "$AWS_REGION"
   # Check the CorsConfiguration block for AllowOrigins, AllowMethods, AllowHeaders
   ```

2. **Update CORS if the frontend origin changed:**
   ```bash
   aws apigatewayv2 update-api \
     --api-id "$API_ID" \
     --cors-configuration "AllowOrigins=$FRONTEND_ORIGIN,AllowMethods=GET,POST,DELETE,OPTIONS,AllowHeaders=authorization,content-type" \
     --region "$AWS_REGION"
   ```

3. **Re-deploy if changes were made:**
   ```bash
   aws apigatewayv2 create-deployment \
     --api-id "$API_ID" \
     --stage-name '$default' \
     --region "$AWS_REGION"
   ```

---

## CI/CD and Automation

### Recommended CI/CD Pipeline

Use a CI/CD platform (GitHub Actions, GitLab CI, AWS CodePipeline, etc.) to automate:

1. **Backend build and test:**
   ```bash
   cd backend
   python -m pytest tests/
   ```

2. **Build and push Lambda container image to ECR:**
   ```bash
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   ECR_REPO="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ecolens-prod-lambda"
   aws ecr get-login-password --region "$AWS_REGION" | \
     docker login --username AWS --password-stdin "$ECR_REPO"
   docker build --platform linux/amd64 -t "$ECR_REPO:latest" -f ml-service/Dockerfile .
   docker push "$ECR_REPO:latest"
   # Update Lambda functions to pull the new image
   aws lambda update-function-code \
     --function-name "ecolens-prod-api-handler" \
     --image-uri "$ECR_REPO:latest" --region "$AWS_REGION"
   aws lambda update-function-code \
     --function-name "ecolens-prod-media-processor" \
     --image-uri "$ECR_REPO:latest" --region "$AWS_REGION"
   ```

3. **Terraform apply (or manual upload):**
   ```bash
   cd infra/terraform
   terraform apply -auto-approve
   ```

4. **Frontend build and deploy:**
   ```bash
   cd frontend
   npm install
   VITE_API_BASE_URL="$(terraform output api_base_url)" npm run build
   aws s3 sync dist/ "s3://$FRONTEND_BUCKET/" --delete --region "$AWS_REGION"
   # Invalidate CloudFront if in use
   ```

### Secrets Management

- **Do NOT** store OCI credentials or Cognito secrets in source control.
- Use CI/CD platform secrets (GitHub Secrets, GitLab CI variables) or AWS Secrets Manager.
- Inject secrets as environment variables at build time.
- For local development, use `.env` files (listed in `.gitignore`).

---

## Security and Best Practices

### Least Privilege IAM

- Create separate IAM roles for each Lambda function if possible.
- Restrict S3 permissions to the specific buckets and keys needed.
- Use resource-based policies to limit API Gateway and S3 invocation of Lambdas.

### OCI Credentials

- Store the OCI private key in AWS Secrets Manager (recommended).
- Never commit the key to source control.
- Use temporary credentials (STS AssumeRole) when possible.
- Audit OCI access logs regularly.

### Data Protection

- Enable S3 bucket encryption (SSE-S3 or SSE-KMS).
- Use HTTPS for all API, presigned URL, and OCI NoSQL traffic.
- Enable versioning on S3 buckets for recovery.
- Set S3 bucket policies to block public access.

### Network Security

- If OCI NoSQL is in a private VCN, ensure Lambda has access via VPC peering or other connectivity.
- Consider using VPC endpoints for private communication.
- Monitor CloudWatch logs for suspicious activity.

---

## Model Versioning and Packaging

### S3-Based Models

1. **Upload models to S3:**
   ```bash
   aws s3 cp models/mdv5a.pt "s3://$MODEL_BUCKET/models/mdv5a.pt" --region "$AWS_REGION"
   aws s3 cp models/labels.txt "s3://$MODEL_BUCKET/models/labels.txt" --region "$AWS_REGION"
   ```

2. **Set environment variables in Lambda:**
   ```bash
   MODEL_S3_BUCKET=ecolens-prod-models-ap-southeast-4
   MODEL_S3_KEY=models/mdv5a.pt
   MODEL_VERSION=v1.0.0
   ```

### Container Image Models

1. **Build and push to ECR:**
   ```bash
   aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   
   docker build -t ecolens-ml:<model-version> -f ml-service/Dockerfile .
   docker tag ecolens-ml:<model-version> <account-id>.dkr.ecr.<region>.amazonaws.com/ecolens-ml:<model-version>
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/ecolens-ml:<model-version>
   ```

2. **Update Lambda image:**
   ```bash
   aws lambda update-function-code \
     --function-name ecolens-prod-media-processor \
     --image-uri <account-id>.dkr.ecr.<region>.amazonaws.com/ecolens-ml:<model-version> \
     --region "$AWS_REGION"
   ```

3. **Tag and version:**
   - Always tag container images with `MODEL_VERSION` for traceability.
   - Use the same version across all deployments for reproducibility.

---

## Terraform-Based Deployment (Recommended)

For repeatable infrastructure-as-code deployment, use the Terraform configuration under `infra/terraform/`:

```bash
cd infra/terraform

# Initialize Terraform
terraform init

# Plan the deployment
terraform plan -out=tfplan

# Apply the plan
terraform apply tfplan

# Retrieve outputs (API endpoint, S3 bucket names, etc.)
terraform output
```

Terraform handles all the above steps automatically and outputs the necessary values for subsequent operations (frontend build, Lambda environment variables, etc.).

---

## Next Steps

After deployment:

1. **Verify the smoke test passes** (see "Smoke Test" section above).
2. **Monitor Lambda logs** in CloudWatch for errors during initial usage.
3. **Set up CloudWatch alarms** for Lambda errors, S3 event lag, and OCI connection failures.
4. **Document deployment outputs** (API endpoint, bucket names, etc.) for your team.
5. **Establish a maintenance schedule** for model updates, dependency patches, and security reviews.
6. **Set up CI/CD pipelines** for automated builds and deployments.
7. **Plan for disaster recovery** (backup OCI NoSQL data, S3 versioning, etc.).