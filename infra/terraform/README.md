# Terraform Infrastructure for EcoLens

This directory contains the Terraform configuration to provision **100% of the required cloud infrastructure** for the EcoLens application across AWS and OCI.

## Prerequisites

- **Terraform 1.2+** installed
- **AWS CLI v2** configured with credentials (access key + secret key)
- **OCI CLI** configured (required for OCI NoSQL metadata storage)
- Access to AWS account with permissions to create: S3, Lambda, IAM, API Gateway (HTTP API v2), ECR, Cognito, SNS, CloudFront
- **Docker** installed and running (Terraform builds and pushes the Lambda container image during `apply`)
- Access to OCI tenancy with permissions to create: NoSQL DB, IAM policies (if using OCI)

## Quick Start

### 1. Initialize Terraform

```bash
cd infra/terraform
terraform init
```

### 2. Create terraform.tfvars

Create a `terraform.tfvars` file with your AWS account details:

```hcl
aws_region          = "us-east-1"
project_prefix      = "ecolens"

# OCI Configuration (required — Oracle NoSQL is the metadata store)
oci_region               = "us-ashburn-1"
oci_user_ocid            = "ocid1.user.oc1..xxxxx"
oci_tenancy_ocid         = "ocid1.tenancy.oc1..xxxxx"
oci_compartment_ocid     = "ocid1.compartment.oc1..xxxxx"
oci_private_key_path     = "/path/to/oci_api_key.pem"
oci_fingerprint          = "xx:xx:xx:xx"
oci_nosql_table_name     = "ecolens_metadata"
oci_nosql_read_units     = 10
oci_nosql_write_units    = 10
oci_nosql_storage_gbs    = 10
```

### 3. Validate Configuration

```bash
terraform fmt      # Format HCL files
terraform validate # Check syntax and configuration
```

### 4. Plan Infrastructure

```bash
terraform plan -out=tfplan
```

### 5. Apply Infrastructure

```bash
terraform apply tfplan
```

## Infrastructure Components

### AWS Services (Primary)

#### **Storage (S3)**
- **ecolens-uploads-{account_id}** — Original media files uploaded by users
  - Versioning: ✅ Enabled
  - Encryption: ✅ AES-256
  - Public Access: ✅ Blocked
  
- **ecolens-thumbnails-{account_id}** — Generated preview thumbnails
  - Versioning: ✅ Enabled
  - Encryption: ✅ AES-256
  - Public Access: ✅ Blocked
  
- **ecolens-detections-{account_id}** — ML model detection results (JSON)
  - Versioning: ✅ Enabled
  - Encryption: ✅ AES-256
  - Public Access: ✅ Blocked
  
- **ecolens-ml-models-{account_id}** — Versioned ML model binaries
  - Versioning: ✅ Enabled (allows model rollback)
  - Encryption: ✅ AES-256
  - Public Access: ✅ Blocked
  - Default prefix: `models/v1`
  
- **ecolens-frontend-{account_id}** — React SPA static assets
  - Versioning: ✅ Enabled
  - Encryption: ✅ AES-256
  - Public Access: ✅ Blocked

- **ecolens-query-temp-{account_id}** — Ephemeral reference file scratch space for `POST /media/similar`
  - Versioning: ❌ Not needed (files are deleted immediately after ML processing)
  - Encryption: ✅ AES-256
  - Public Access: ✅ Blocked
  - Note: Files in this bucket are never written to the database and are not stored permanently

#### **Container Registry (ECR)**
- **ecolens-lambda** — ECR repository holding the ML processor container image
  - Built from `ml-service/Dockerfile` (bundles PyTorch, MegaDetector, `ml_pipeline`, backend tagging handler)
  - Terraform builds and pushes the image automatically during `apply` via `null_resource.lambda_image_push`
  - Only the ML Lambda (`ecolens-s3-handler`) uses this image

#### **Compute (Lambda — two deployments)**
- **ecolens-api** — FastAPI/Mangum REST API handler
  - Package type: **`Zip`** (no ML model — lightweight FastAPI/Mangum only)
  - Handler: `backend.src.main.handler`
  - Timeout: 300 seconds
  - Memory: 1024 MB
  - Environment variables: `S3_UPLOAD_BUCKET`, `S3_THUMBNAIL_BUCKET`, `S3_DETECTIONS_BUCKET`, `S3_QUERY_TEMP_BUCKET`, `ML_LAMBDA_NAME`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `SNS_TOPIC_ARN`, `FRONTEND_ORIGIN`, OCI vars
  - Triggers: API Gateway HTTP API v2 `$default` catch-all route

- **ecolens-s3-handler** — S3 event processor: dedup, thumbnails, ML inference, metadata write
  - Package type: **`Image`** (container from ECR — PyTorch requires container deployment)
  - Entry-point (`image_config.command`): `backend.src.tagging_handler.lambda_handler`
  - Timeout: 300 seconds
  - Memory: 3008 MB (MegaDetector requires ~2.5 GB RAM)
  - Environment variables: same as API Lambda plus `S3_QUERY_TEMP_BUCKET` and model S3 vars (`MODEL_S3_KEY`, `MODEL_VERSION`)
  - Triggers: S3 `ObjectCreated:*` events from uploads bucket

#### **Authentication (Cognito)**
- **ecolens-user-pool** — Manages user sign-up, sign-in, and password reset
  - Email verification: ✅ Enabled
  - Username attribute: `email`
  - Password policy: Min 8 chars, uppercase, lowercase, numbers
  
- **ecolens-app-client** — OAuth 2.0 app client for frontend
  - Auth flows: USER_PASSWORD_AUTH, REFRESH_TOKEN_AUTH, USER_SRP_AUTH
  - OAuth flows: Authorization Code, Implicit
  - Scopes: email, openid, profile
  - Client Secret: not generated (`generate_secret = false`) — public client for browser use

#### **API Gateway HTTP API v2**
- **ecolens-http-api** — HTTP API v2 for all backend endpoints
  - Authorizer: JWT type, backed by Cognito user pool — tokens are validated at the gateway before Lambda is invoked
  - Routing: `$default` catch-all route forwards all requests to the API Lambda; Mangum/FastAPI handles routing internally
  - CORS: built-in `cors_configuration` block — no MOCK integrations or manual OPTIONS routes needed
  - Stage: `$default` — invoke URL has **no path prefix**: `https://<id>.execute-api.<region>.amazonaws.com`
  - RESTful endpoints served by the backend:
    - `GET    /health` — public health probe (no auth)
    - `GET    /users/me` — echo authenticated user
    - `POST   /uploads` — dedup check + presigned S3 PUT URL
    - `GET    /media?tag=koala:2&tag=wombat:1` — search by tag counts (AND, min count)
    - `GET    /media?species=koala&species=dingo` — search by species (AND, count ≥ 1)
    - `GET    /media/{file_id}` — resolve file_id → full-size URL
    - `POST   /media/similar/presign` — get presigned URL for reference file upload
    - `POST   /media/similar` — find similar by pre-uploaded reference file (sync for images, async 202 for videos)
    - `GET    /media/similar/result/{job_id}` — poll async video similarity result
    - `POST   /media/tags` — bulk add/remove tags (any authenticated user)
    - `DELETE /media` — delete files, thumbnails, and DB records (owner only)
    - `GET    /subscriptions` — get current SNS subscription (species + status)
    - `POST   /subscriptions` — subscribe / update species-watch email notifications
    - `DELETE /subscriptions` — cancel current SNS subscription

#### **Messaging (SNS)**
- **ecolens-tags** — SNS topic for tag notifications
  - Subscribers: Lambda, frontend via WebSocket (optional)
  - Message format: JSON with file metadata and detection results

#### **CDN (CloudFront)**
- **ecolens-frontend-cdn** — CDN for static React SPA
  - Origin: ecolens-frontend-{account_id} S3 bucket
  - SSL/TLS: ✅ Enforced
  - Caching: Optimized for SPA (cache index.html, version CSS/JS)
  - Viewer Function: Redirect `/` to `/index.html` for SPA routing

#### **IAM Roles & Policies**
- **ecolens-lambda-role** — Execution role for both Lambda functions
  - S3 permissions: GetObject, PutObject, DeleteObject, ListBucket, GetObjectVersion (all EcoLens buckets)
  - SNS permissions: Publish, Subscribe, Unsubscribe, SetSubscriptionAttributes, GetSubscriptionAttributes, ListSubscriptionsByTopic
  - CloudWatch Logs: CreateLogGroup, CreateLogStream, PutLogEvents
  - Lambda: InvokeFunction (ML processor only — for async video similarity queries)
  - IAM policy: See `infra/iam/api_lambda_role.json`

### OCI Services (Required - Metadata Storage)

#### **Oracle NoSQL Database**
- **ecolens_metadata** — Document store for file metadata
  - Partition Key: `media_id` (String — SHA-256 checksum of the file)
  - Schema: `media_id`, `user_id`, `file_type`, `status`, `source_url`, `thumbnail_url`, `original_key`, `thumbnail_key`, `detections_key`, `tags`, `animal_detected`, `top_confidence`, `created_at`
  - Billing: On-demand read/write units (configurable)
  - Creates on condition: `var.oci_user_ocid != ""`

#### **OCI IAM Policy**
- Allows Lambda to assume cross-cloud role to access OCI NoSQL
- Service: OCI > Identity > Policies
- Note: Requires manual setup in OCI console or additional OCI provider configuration

## Resource Naming Convention

All AWS resources follow the pattern:

```
{project_prefix}-{component}-{aws_account_id}
```

Examples:
- `ecolens-uploads-123456789012`
- `ecolens-api`
- `ecolens-user-pool`
- `ecolens-frontend-cdn`

## Environment Variables Generated

After `terraform apply`, use the `environment_config` output to populate:

### Backend `.env`

```bash
AWS_REGION=us-east-1
S3_UPLOAD_BUCKET=ecolens-uploads-123456789012
S3_THUMBNAIL_BUCKET=ecolens-thumbnails-123456789012
S3_DETECTIONS_BUCKET=ecolens-detections-123456789012
S3_QUERY_TEMP_BUCKET=ecolens-query-temp-123456789012
ML_MODELS_BUCKET=ecolens-ml-models-123456789012
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=abcdef1234567890
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:ecolens-tags
FRONTEND_ORIGIN=https://d123abc.cloudfront.net
```

### Frontend `.env.local`

```bash
VITE_API_BASE_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_REGION=us-east-1
VITE_COGNITO_CLIENT_ID=abcdef1234567890
VITE_COGNITO_POOL_ID=us-east-1_xxxxxxxxx
```

## Outputs

After deployment, retrieve outputs using:

```bash
# Get all outputs
terraform output

# Get specific output (JSON formatted)
terraform output -json environment_config
terraform output cognito_user_pool_id
terraform output frontend_url
```

Key outputs:
- `frontend_url` — Public URL for the React application
- `api_gateway_endpoint` — Backend API endpoint
- `cognito_user_pool_id` — For backend authentication
- `cognito_app_client_id` — For frontend Cognito SDK
- `s3_*_bucket` — All S3 bucket names (uploads, thumbnails, detections, models, frontend, query-temp)
- `lambda_api_function_name` — API Lambda function
- `lambda_s3_handler_function_name` — ML pipeline Lambda

## Common Operations

### Update Lambda Function Code

The two Lambdas use different deployment packages. The ML Lambda uses a container image (ECR); the API Lambda uses a ZIP package.

**ML Lambda (container image):** Rebuild and push to ECR, then trigger a re-deploy.

1. Rebuild and push the container image:
   ```bash
   # From the project root
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   ECR_REPO="$ACCOUNT_ID.dkr.ecr.<region>.amazonaws.com/ecolens-lambda"
   aws ecr get-login-password --region <region> | \
     docker login --username AWS --password-stdin "$ECR_REPO"
   docker build --platform linux/amd64 -t "$ECR_REPO:latest" -f ml-service/Dockerfile .
   docker push "$ECR_REPO:latest"
   ```

2. Let Terraform re-deploy (the `lambda_image_push` trigger detects source file changes):
   ```bash
   cd infra/terraform
   terraform apply -target=null_resource.lambda_image_push \
                   -target=aws_lambda_function.api \
                   -target=aws_lambda_function.s3_handler
   ```

### Add New S3 Bucket

1. Add to `main.tf`:
   ```hcl
   resource "aws_s3_bucket" "new_bucket" {
     bucket = "${var.project_prefix}-new-${data.aws_caller_identity.current.account_id}"
   }
   ```

2. Add to Lambda policy if needed

3. Apply:
   ```bash
   terraform plan
   terraform apply
   ```

### Scale Lambda Resources

Update `main.tf`:
```hcl
resource "aws_lambda_function" "api" {
  memory_size = 1024  # current default
  timeout     = 120   # Increase from 60s
}

terraform apply -target=aws_lambda_function.api
```

### Change Cognito Password Policy

Update `main.tf`:
```hcl
resource "aws_cognito_user_pool" "main" {
  password_policy {
    minimum_length    = 12  # Increase minimum length
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true  # Add symbols requirement
    require_uppercase = true
  }
}

terraform apply -target=aws_cognito_user_pool.main
```

## State Management

### Remote State (Recommended)

Set up S3 backend for state sharing:

1. Create S3 bucket for Terraform state:
   ```bash
   aws s3 mb s3://ecolens-terraform-state-$(aws sts get-caller-identity --query Account --output text)
   ```
   > **Note:** This project uses **OCI NoSQL** as its application database — not AWS DynamoDB.
   > The S3 backend below stores only Terraform state files. State locking is handled
   > by OCI Object Storage or can be omitted for single-operator deployments.

2. Create `backend.tf`:
   ```hcl
   terraform {
     backend "s3" {
       bucket  = "ecolens-terraform-state-123456789012"
       key     = "ecolens/infra/terraform.tfstate"
       region  = "us-east-1"
       encrypt = true
       # dynamodb_table omitted — app DB is OCI NoSQL, not DynamoDB
     }
   }
   ```

3. Reinitialize:
   ```bash
   terraform init
   ```

### Local State (Development Only)

If using local state, add to `.gitignore`:
```
terraform.tfstate*
.terraform/
*.tfplan
```

## Security Best Practices

1. **Never commit sensitive data** — Use `terraform.tfvars` (in `.gitignore`) or environment variables
2. **Enable versioning** — All S3 buckets have versioning enabled for accidental deletion recovery
3. **Enforce encryption** — All S3 buckets use AES-256 encryption at rest
4. **Block public access** — All S3 buckets have public access blocked
5. **Use Cognito JWT** — API routes are protected with Cognito JWT validation
6. **Limit IAM permissions** — Lambda roles have minimal required permissions
7. **Enable CloudWatch logging** — All Lambda functions log to CloudWatch

## Troubleshooting

### Terraform Init Fails

**Problem:** `Provider registry does not have a package for provider`

**Solution:** Ensure you have internet access and Terraform can reach registry.terraform.io

```bash
terraform init -upgrade
```

### Apply Fails - Insufficient S3 Bucket Permissions

**Problem:** `Error creating S3 bucket: AccessDenied`

**Solution:** Verify AWS credentials have `s3:CreateBucket`, `s3:PutBucketVersioning` permissions

### Lambda Function Not Triggering

**Problem:** S3 events not invoking Lambda

**Solution:** Check:
1. S3 bucket notification configuration: `aws s3api get-bucket-notification-configuration --bucket ecolens-uploads-123456789012`
2. Lambda execution role has `s3:GetObject` on uploads bucket
3. Lambda has `lambda:InvokeFunction` permission for S3

### Cognito Sign-In Fails

**Problem:** `Invalid client id` or `Client authentication failed`

**Solution:**
1. Verify `VITE_COGNITO_CLIENT_ID` matches `terraform output cognito_app_client_id`
2. Confirm user pool exists: `aws cognito-idp list-user-pools --max-results 10`
3. Check app client settings: `aws cognito-idp describe-user-pool-client --user-pool-id ... --client-id ...`

### CloudFront Cache Issues

**Problem:** Frontend showing old version

**Solution:**
1. Create invalidation: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"`
2. Or force refresh with `Ctrl+Shift+R` in browser (bypasses CloudFront cache)

## Documentation References

- [infra/README.md](../README.md) — High-level architecture and design decisions
- [infra/architecture.md](../architecture.md) — Data flow Mermaid diagram
- [PROJECT_REQUIREMENTS.md](../../PROJECT_REQUIREMENTS.md) — Full requirements specification
- [backend/README.md](../../backend/README.md) — Lambda handler implementation
- [frontend/README.md](../../frontend/README.md) — React SPA implementation

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review [PROJECT_REQUIREMENTS.md](../../PROJECT_REQUIREMENTS.md) for architecture decisions
3. Consult Terraform docs: https://www.terraform.io/docs
4. Check AWS service documentation for specific resource configurations
