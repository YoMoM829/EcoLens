// Terraform skeleton for AWS (S3, Cognito, Lambda, API Gateway, SNS) and OCI NoSQL
// This is a starting point. Fill provider credentials, region, and variable values before applying.

terraform {
  required_providers {
    aws  = { source = "hashicorp/aws" }
    oci  = { source = "oracle/oci" }
    null = { source = "hashicorp/null" }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "oci" {
  tenancy_ocid     = var.oci_tenancy_ocid
  user_ocid        = var.oci_user_ocid
  fingerprint      = var.oci_fingerprint
  private_key_path = var.oci_private_key_path
  region           = var.oci_region
}

// ── ECR repository for Lambda container images ────────────────────────────
// Both the API Lambda and the S3 handler Lambda use the same image;
// image_config.command on each function selects the correct entry-point.
resource "aws_ecr_repository" "lambda" {
  name                 = "${var.project_prefix}-lambda"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

// Build the Docker image from ml-service/Dockerfile (ML Lambda only — PyTorch + MegaDetector).
// The API Lambda is deployed as a ZIP package (see aws_lambda_function.api below).
// Runs whenever ML-related source files change.
resource "null_resource" "lambda_image_push" {
  triggers = {
    dockerfile      = filesha256("${path.module}/../../ml-service/Dockerfile")
    ml_requirements = filesha256("${path.module}/../../ml-service/requirements.txt")
    tagging         = filesha256("${path.module}/../../backend/src/tagging_handler.py")
    ecr_repo        = aws_ecr_repository.lambda.repository_url
  }

  provisioner "local-exec" {
    command = <<EOT
set -e
REPO="${aws_ecr_repository.lambda.repository_url}"
REGION="${var.aws_region}"
ROOT="$(cd "${path.module}/../.." && pwd)"

echo "Authenticating Docker to ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$REPO"

echo "Building ML Lambda container image..."
docker buildx build --platform linux/amd64 --provenance=false --load \
  -t "$REPO:latest" -f "$ROOT/ml-service/Dockerfile" "$ROOT"

echo "Pushing image to ECR..."
docker push "$REPO:latest"
echo "Done — image pushed to $REPO:latest"
EOT
  }

  depends_on = [aws_ecr_repository.lambda]
}

resource "null_resource" "frontend_deploy" {
  triggers = {
    app = sha256(join("", [for file in concat(
      ["package.json", "package-lock.json", "vite.config.ts", "index.html"],
      [for file in fileset("${path.module}/../../frontend/src", "**") : "src/${file}"]
    ) : filesha256("${path.module}/../../frontend/${file}")]))
    api_base_url = aws_apigatewayv2_api.backend.api_endpoint
    distribution = aws_cloudfront_distribution.frontend.id
  }

  provisioner "local-exec" {
    command = <<EOT
cd "${path.module}/../../frontend" && \
VITE_API_BASE_URL="${aws_apigatewayv2_api.backend.api_endpoint}" npm ci && \
VITE_API_BASE_URL="${aws_apigatewayv2_api.backend.api_endpoint}" npm run build && \
aws s3 sync dist "s3://${aws_s3_bucket.frontend.bucket}" --delete && \
aws cloudfront create-invalidation --distribution-id "${aws_cloudfront_distribution.frontend.id}" --paths "/*"
EOT
  }

  depends_on = [aws_cloudfront_distribution.frontend, aws_apigatewayv2_stage.backend, null_resource.lambda_image_push]
}


data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_role" {
  name               = "${var.project_prefix}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_s3_access" {
  name = "${var.project_prefix}-lambda-s3-access"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${aws_s3_bucket.uploads.arn}/*",
          "${aws_s3_bucket.thumbnails.arn}/*",
          "${aws_s3_bucket.detections.arn}/*",
          "${aws_s3_bucket.query_temp.arn}/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.models.arn}/*"
      },
      {
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = [
          aws_s3_bucket.uploads.arn,
          aws_s3_bucket.thumbnails.arn,
          aws_s3_bucket.detections.arn,
          aws_s3_bucket.models.arn,
          aws_s3_bucket.query_temp.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_sns_access" {
  name = "${var.project_prefix}-lambda-sns-access"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish", "sns:Subscribe", "sns:Unsubscribe", "sns:SetSubscriptionAttributes", "sns:GetSubscriptionAttributes", "sns:ListSubscriptionsByTopic"]
        Resource = [aws_sns_topic.tags.arn]
      }
    ]
  })
}

// Lambda needs to pull its own container image from ECR at cold-start
resource "aws_iam_role_policy" "lambda_ecr_access" {
  name = "${var.project_prefix}-lambda-ecr-access"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_oci_access" {
  count = var.oci_user_ocid != "" ? 1 : 0
  name  = "${var.project_prefix}-lambda-oci-access"
  role  = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sts:AssumeRole"]
        Resource = "arn:aws:iam::*:role/lambda-oci-access-role"
      }
    ]
  })
}

// Allow the API Lambda to invoke the ML Lambda synchronously for query-by-file requests
resource "aws_iam_role_policy" "lambda_invoke_ml" {
  name = "${var.project_prefix}-lambda-invoke-ml"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:*:*:function:${var.project_prefix}-media-processor"
      }
    ]
  })
}

// Data source to get current AWS account ID
data "aws_caller_identity" "current" {}

// S3 bucket for uploads
resource "aws_s3_bucket" "uploads" {
  bucket = var.s3_bucket_name
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  // Must be false: S3 CORS preflight (OPTIONS) is unauthenticated.
  // With restrict_public_buckets=true, S3 returns HTTP 500 on OPTIONS requests,
  // breaking browser presigned-PUT uploads. Objects remain private — only
  // accessible via presigned URLs.
  restrict_public_buckets = false
}

// S3 bucket for thumbnails
resource "aws_s3_bucket" "thumbnails" {
  bucket = "${var.project_prefix}-thumbnails-${data.aws_caller_identity.current.account_id}"
}

// Thumbnails are derived from originals and can be regenerated — no versioning needed
resource "aws_s3_bucket_versioning" "thumbnails" {
  bucket = aws_s3_bucket.thumbnails.id
  versioning_configuration {
    status = "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "thumbnails" {
  bucket = aws_s3_bucket.thumbnails.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "thumbnails" {
  bucket = aws_s3_bucket.thumbnails.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

// S3 bucket for ML detection results
resource "aws_s3_bucket" "detections" {
  bucket = "${var.project_prefix}-detections-${data.aws_caller_identity.current.account_id}"
}

// Detection JSON is derived from originals and can be regenerated — no versioning needed
resource "aws_s3_bucket_versioning" "detections" {
  bucket = aws_s3_bucket.detections.id
  versioning_configuration {
    status = "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "detections" {
  bucket = aws_s3_bucket.detections.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "detections" {
  bucket = aws_s3_bucket.detections.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

// S3 bucket for ML models (versioning support)
resource "aws_s3_bucket" "models" {
  bucket = "${var.project_prefix}-ml-models-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "models" {
  bucket = aws_s3_bucket.models.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "models" {
  bucket = aws_s3_bucket.models.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "models" {
  bucket = aws_s3_bucket.models.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "frontend" {
  bucket = var.frontend_bucket_name
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_prefix}-frontend-oac"
  description                       = "OAC for frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "EcoLens frontend distribution"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "frontend-s3-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "frontend-s3-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "frontend_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontRead"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket_policy.json

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

// SNS topic for notifications
resource "aws_sns_topic" "tags" {
  name = "${var.project_prefix}-tags"
}

// AWS Cognito User Pool for authentication
resource "aws_cognito_user_pool" "main" {
  name = "${var.project_prefix}-user-pool"

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  // Standard attributes required by §3.1: email, first name, last name.
  // given_name / family_name are mapped to firstName / lastName in cognitoClient.ts's
  // SignUpCommand UserAttributes array.  Without these schema declarations Cognito
  // rejects sign-up requests with InvalidParameterException.
  schema {
    name                = "given_name"
    attribute_data_type = "String"
    mutable             = true
    required            = true
    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  schema {
    name                = "family_name"
    attribute_data_type = "String"
    mutable             = true
    required            = true
    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  tags = {
    Name = "${var.project_prefix}-user-pool"
  }
}

// Cognito App Client
resource "aws_cognito_user_pool_client" "main" {
  name                                 = "${var.project_prefix}-app-client"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  allowed_oauth_flows_user_pool_client = true
  prevent_user_existence_errors        = "ENABLED"

  depends_on = [aws_cognito_user_pool.main]
}

// ── API Gateway HTTP API (v2) ─────────────────────────────────────────────────
// HTTP API v2 is the modern choice: lower latency, lower cost (~$1/M vs $3.50/M),
// built-in CORS config, native JWT authorizer, and $default stage (no /prod path prefix).
// The JWT authorizer points at the Cognito user pool — tokens issued by Cognito are
// validated at the gateway before Lambda is ever invoked.

resource "aws_apigatewayv2_api" "backend" {
  name          = "${var.project_prefix}-http-api"
  protocol_type = "HTTP"
  description   = "EcoLens RESTful API — FastAPI/Mangum on Lambda"

  // Built-in CORS support: handles OPTIONS preflight automatically with no extra
  // resources. FastAPI CORSMiddleware adds the same headers on non-OPTIONS responses.
  cors_configuration {
    allow_origins = [var.frontend_origin, "http://localhost:5173"]
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
}

// JWT authorizer backed by Cognito — validates every request token against the
// Cognito JWKS endpoint before Lambda is invoked. audience must match the app client ID.
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.backend.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.project_prefix}-cognito-jwt"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.main.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }

  depends_on = [aws_cognito_user_pool.main, aws_cognito_user_pool_client.main]
}
// ── Lambda: API handler (ZIP package — no PyTorch) ────────────────────────────
// FastAPI + Mangum + OCI SDK + boto3. Lightweight — fits in a 250 MB ZIP.
// Query-by-file requests are forwarded to the ML Lambda via boto3 invoke
// after the browser uploads the file directly to S3 (bypassing API Gateway's
// 6 MB body limit). handler / runtime are set for ZIP; no image_config needed.
//
// NOTE: Do NOT set AWS_REGION — it is reserved by the Lambda runtime and cannot
// be overridden. The code reads AWS_DEFAULT_REGION (set automatically by Lambda).

// Build step: pip-install all backend dependencies into a clean package dir,
// then copy the backend/ source tree next to them.  This is required because
// `archive_file` only zips raw files — it does NOT run pip.  Lambda imports
// packages from the root of the zip, so both the installed libs and the
// `backend/` package must live at the same level inside the archive.
resource "null_resource" "build_api_package" {
  triggers = {
    requirements = filesha256("${path.module}/../../backend/requirements.txt")
    // Re-build whenever any backend Python file changes
    source = sha256(join("", [
      for f in sort(fileset("${path.module}/../../backend", "**/*.py")) :
      filesha256("${path.module}/../../backend/${f}")
    ]))
  }

  provisioner "local-exec" {
    command = <<EOT
set -e
PKG="${path.module}/build/api_package"
echo "Cleaning old build..."
rm -rf "$PKG"
mkdir -p "$PKG"

echo "Installing backend dependencies..."
pip install \
  -r "${path.module}/../../backend/requirements.txt" \
  -t "$PKG" \
  --quiet \
  --no-cache-dir

echo "Copying backend source..."
# Copy the top-level backend package (directory + __init__.py) into the package root
cp -r "${path.module}/../../backend" "$PKG/"

echo "API Lambda package built at $PKG"
EOT
  }
}

// Zip the pre-built package directory (source + installed libs together).
// depends_on ensures the build step runs first on every relevant change.
data "archive_file" "api_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/build/api_package"
  output_path = "${path.module}/build/api_lambda.zip"
  depends_on  = [null_resource.build_api_package]
  excludes = [
    "**/__pycache__/**",
    "**/*.pyc",
    "**/.pytest_cache/**",
    "**/tests/**",
  ]
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project_prefix}-api-handler"
  role             = aws_iam_role.lambda_role.arn
  package_type     = "Zip"
  filename         = data.archive_file.api_lambda_zip.output_path
  source_code_hash = data.archive_file.api_lambda_zip.output_base64sha256
  runtime          = "python3.11"
  handler          = "backend.src.main.handler"
  timeout          = 60
  memory_size      = 1024

  environment {
    variables = {
      S3_UPLOAD_BUCKET           = aws_s3_bucket.uploads.bucket
      S3_THUMBNAIL_BUCKET        = aws_s3_bucket.thumbnails.bucket
      S3_DETECTIONS_BUCKET       = aws_s3_bucket.detections.bucket
      S3_QUERY_TEMP_BUCKET       = aws_s3_bucket.query_temp.bucket
      COGNITO_USER_POOL_ID       = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID          = aws_cognito_user_pool_client.main.id
      SNS_TOPIC_ARN              = aws_sns_topic.tags.arn
      FRONTEND_ORIGIN            = var.frontend_origin
      ML_LAMBDA_NAME             = "${var.project_prefix}-media-processor"
      OCI_REGION                 = var.oci_region
      OCI_TENANCY_OCID           = var.oci_tenancy_ocid
      OCI_USER_OCID              = var.oci_user_ocid
      OCI_FINGERPRINT            = var.oci_fingerprint
      OCI_PRIVATE_KEY_PATH       = var.oci_private_key_path
      OCI_PRIVATE_KEY_CONTENT    = var.oci_private_key_content
      OCI_PASSPHRASE             = var.oci_passphrase
      OCI_NOSQL_TABLE_NAME       = var.oci_nosql_table_name
      OCI_NOSQL_COMPARTMENT_OCID = var.oci_nosql_compartment_ocid
      OCI_NOSQL_ENDPOINT         = var.oci_endpoint
      USE_OCI_DB                 = var.oci_user_ocid != "" ? "1" : "0"
    }
  }

  depends_on = [
    null_resource.build_api_package,
    aws_iam_role_policy.lambda_s3_access,
    aws_iam_role_policy.lambda_sns_access,
    aws_iam_role_policy.lambda_invoke_ml,
    aws_cognito_user_pool.main,
    aws_cognito_user_pool_client.main
  ]
}

// ── Lambda: ML processor (container image — PyTorch + MegaDetector) ───────────
// Handles two event types:
//   1. S3 ObjectCreated trigger  — full pipeline: detect → thumbnail → DB write → SNS
//   2. Direct boto3 invoke from API Lambda — detect only, return tags, no DB write
// Needs 3008 MB RAM (MegaDetector uses ~2.5 GB) and 300s timeout.
//
// NOTE: Do NOT set AWS_REGION — it is reserved by the Lambda runtime.

resource "aws_lambda_function" "s3_handler" {
  function_name = "${var.project_prefix}-media-processor"
  role          = aws_iam_role.lambda_role.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda.repository_url}:latest"
  timeout       = 300
  memory_size   = 3008

  image_config {
    command = ["backend.src.tagging_handler.lambda_handler"]
  }

  environment {
    variables = {
      S3_UPLOAD_BUCKET           = aws_s3_bucket.uploads.bucket
      S3_THUMBNAIL_BUCKET        = aws_s3_bucket.thumbnails.bucket
      S3_DETECTIONS_BUCKET       = aws_s3_bucket.detections.bucket
      S3_QUERY_TEMP_BUCKET       = aws_s3_bucket.query_temp.bucket
      MEGADETECTOR_S3_BUCKET     = aws_s3_bucket.models.bucket
      MEGADETECTOR_S3_KEY        = var.megadetector_s3_key
      MODEL_S3_BUCKET            = aws_s3_bucket.models.bucket
      MODEL_S3_KEY               = var.model_s3_key
      COGNITO_USER_POOL_ID       = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID          = aws_cognito_user_pool_client.main.id
      SNS_TOPIC_ARN              = aws_sns_topic.tags.arn
      FRONTEND_ORIGIN            = var.frontend_origin
      OCI_REGION                 = var.oci_region
      OCI_TENANCY_OCID           = var.oci_tenancy_ocid
      OCI_USER_OCID              = var.oci_user_ocid
      OCI_FINGERPRINT            = var.oci_fingerprint
      OCI_PRIVATE_KEY_PATH       = var.oci_private_key_path
      OCI_PRIVATE_KEY_CONTENT    = var.oci_private_key_content
      OCI_PASSPHRASE             = var.oci_passphrase
      OCI_NOSQL_TABLE_NAME       = var.oci_nosql_table_name
      OCI_NOSQL_COMPARTMENT_OCID = var.oci_nosql_compartment_ocid
      OCI_NOSQL_ENDPOINT         = var.oci_endpoint
      USE_OCI_DB                 = var.oci_user_ocid != "" ? "1" : "0"
    }
  }

  depends_on = [
    null_resource.lambda_image_push,
    aws_iam_role_policy.lambda_s3_access,
    aws_iam_role_policy.lambda_sns_access,
    aws_iam_role_policy.lambda_ecr_access
  ]
}

// Single $default stage with auto_deploy — changes are live immediately,
// no manual deployment step needed, and the invoke URL has no path prefix.
resource "aws_apigatewayv2_stage" "backend" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true
}

// Single catch-all route: any method, any path → API Lambda.
// Mangum/FastAPI handles all routing internally.
// The JWT authorizer runs before Lambda for every request on this route.
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  // Raise the gateway timeout to allow ML inference in POST /media/similar to complete.
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "default" {
  api_id             = aws_apigatewayv2_api.backend.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "allow_api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_s3" {
  statement_id  = "AllowExecutionFromS3"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.s3_handler.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.uploads.arn
}

resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.s3_handler.arn
    events              = ["s3:ObjectCreated:*"]
    // Trigger on all uploads — no prefix filter needed because query-by-file
    // temp files go to a separate bucket (ecolens-query-temp-*), not here.
  }

  depends_on = [aws_lambda_permission.allow_s3]
}

// ── Query-temp S3 bucket ──────────────────────────────────────────────────────
// Dedicated bucket for query-by-file temporary uploads.
// - No S3 event notification → ML Lambda is NOT triggered automatically
// - API Lambda writes here, invokes ML Lambda directly with the key, then deletes the file
// - 1-day lifecycle rule auto-deletes any files orphaned by Lambda errors
// - CORS allows browser to PUT directly (bypasses API Gateway 6 MB limit)
// - No versioning (temp files only)

resource "aws_s3_bucket" "query_temp" {
  bucket = "${var.project_prefix}-query-temp-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "query_temp" {
  bucket = aws_s3_bucket.query_temp.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  // Must be false so S3 can respond to unauthenticated CORS preflight (OPTIONS)
  // for presigned PUT requests from the browser.
  restrict_public_buckets = false
}

resource "aws_s3_bucket_cors_configuration" "query_temp" {
  bucket = aws_s3_bucket.query_temp.id

  cors_rule {
    allowed_origins = [var.frontend_origin, "http://localhost:5173"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "query_temp_cleanup" {
  bucket = aws_s3_bucket.query_temp.id

  rule {
    id     = "auto-delete-temp-files"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = 1
    }
  }
}

// OCI NoSQL Table for metadata storage
resource "oci_nosql_table" "metadata" {
  count = var.oci_user_ocid != "" && var.oci_nosql_table_name != "" ? 1 : 0

  compartment_id = var.oci_nosql_compartment_ocid
  name           = var.oci_nosql_table_name
  ddl_statement  = "CREATE TABLE IF NOT EXISTS ${var.oci_nosql_table_name} (media_id STRING, owner STRING, original_key STRING, thumbnail_key STRING, detections_key STRING, file_type STRING, tags JSON, status STRING, created_at STRING, updated_at STRING, PRIMARY KEY (SHARD(media_id)))"

  table_limits {
    max_read_units     = var.oci_nosql_read_units
    max_write_units    = var.oci_nosql_write_units
    max_storage_in_gbs = var.oci_nosql_storage_gbs
  }

}
