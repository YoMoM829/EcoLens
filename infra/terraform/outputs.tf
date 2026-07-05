# Terraform Outputs for EcoLens Infrastructure

output "aws_region" {
  description = "AWS region where resources are deployed"
  value       = var.aws_region
}

output "s3_uploads_bucket" {
  description = "S3 bucket for media uploads"
  value       = aws_s3_bucket.uploads.id
}

output "s3_thumbnails_bucket" {
  description = "S3 bucket for generated thumbnails"
  value       = aws_s3_bucket.thumbnails.id
}

output "s3_detections_bucket" {
  description = "S3 bucket for ML detection results"
  value       = aws_s3_bucket.detections.id
}

output "s3_models_bucket" {
  description = "S3 bucket for versioned ML models"
  value       = aws_s3_bucket.models.id
}

output "s3_frontend_bucket" {
  description = "S3 bucket for frontend static assets"
  value       = aws_s3_bucket.frontend.id
}

# Cognito Outputs
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID for authentication"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "cognito_app_client_id" {
  description = "Cognito App Client ID (use in frontend)"
  value       = aws_cognito_user_pool_client.main.id
  sensitive   = true
}

# SNS Outputs
output "sns_topic_arn" {
  description = "SNS topic ARN for tag notifications"
  value       = aws_sns_topic.tags.arn
}

output "sns_topic_name" {
  description = "SNS topic name"
  value       = aws_sns_topic.tags.name
}

# ECR Outputs
output "ecr_repository_url" {
  description = "ECR repository URL for the Lambda container image"
  value       = aws_ecr_repository.lambda.repository_url
}

# Lambda Outputs
output "lambda_api_function_name" {
  description = "API Lambda function name"
  value       = aws_lambda_function.api.function_name
}

output "lambda_api_function_arn" {
  description = "API Lambda function ARN"
  value       = aws_lambda_function.api.arn
}

output "lambda_s3_handler_function_name" {
  description = "S3 handler Lambda function name"
  value       = aws_lambda_function.s3_handler.function_name
}

output "lambda_s3_handler_function_arn" {
  description = "S3 handler Lambda function ARN"
  value       = aws_lambda_function.s3_handler.arn
}

output "lambda_role_arn" {
  description = "IAM role ARN for Lambda functions"
  value       = aws_iam_role.lambda_role.arn
}

# API Gateway Outputs
output "api_gateway_api_id" {
  description = "API Gateway HTTP API ID"
  value       = aws_apigatewayv2_api.backend.id
}

output "api_gateway_endpoint" {
  description = "API Gateway invoke URL — no path prefix ($default stage)"
  value       = aws_apigatewayv2_api.backend.api_endpoint
}

output "api_gateway_authorizer_id" {
  description = "API Gateway Cognito JWT authorizer ID"
  value       = aws_apigatewayv2_authorizer.cognito.id
}

# CloudFront Outputs
output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_url" {
  description = "Frontend application URL (via CloudFront)"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

# OCI Outputs
output "oci_nosql_table_name" {
  description = "OCI NoSQL table name for metadata"
  value       = try(oci_nosql_table.metadata[0].name, "Not configured")
}

output "oci_nosql_table_id" {
  description = "OCI NoSQL table OCID"
  value       = try(oci_nosql_table.metadata[0].id, "Not configured")
}

# Environment Configuration Summary
output "environment_config" {
  description = "Environment configuration summary for .env files"
  value = {
    # AWS Configuration
    AWS_REGION           = var.aws_region
    S3_UPLOAD_BUCKET     = aws_s3_bucket.uploads.id
    S3_THUMBNAIL_BUCKET  = aws_s3_bucket.thumbnails.id
    S3_DETECTIONS_BUCKET = aws_s3_bucket.detections.id
    ML_MODELS_BUCKET     = aws_s3_bucket.models.id
    ML_MODELS_PREFIX     = "models/v1"

    # Cognito Configuration
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
    COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.main.id
    COGNITO_REGION       = var.aws_region

    # API Configuration
    API_ENDPOINT = aws_apigatewayv2_api.backend.api_endpoint

    # SNS Configuration
    SNS_TOPIC_ARN = aws_sns_topic.tags.arn

    # Frontend Configuration
    FRONTEND_URL    = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    FRONTEND_BUCKET = aws_s3_bucket.frontend.id

    # OCI Configuration (if enabled)
    OCI_REGION           = var.oci_region
    OCI_NOSQL_TABLE_NAME = try(oci_nosql_table.metadata[0].name, "N/A")
  }
  sensitive = true
}

# Quick Reference
output "quick_reference" {
  description = "Quick reference guide for deployment"
  value = {
    step_1_add_to_backend_env  = "S3_UPLOAD_BUCKET=${aws_s3_bucket.uploads.id}, S3_THUMBNAIL_BUCKET=${aws_s3_bucket.thumbnails.id}, S3_DETECTIONS_BUCKET=${aws_s3_bucket.detections.id}, COGNITO_USER_POOL_ID=${aws_cognito_user_pool.main.id}"
    step_2_add_to_frontend_env = "VITE_API_BASE_URL=${aws_apigatewayv2_api.backend.api_endpoint}, VITE_COGNITO_REGION=${var.aws_region}, VITE_COGNITO_CLIENT_ID=${aws_cognito_user_pool_client.main.id}"
    step_3_frontend_url        = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    step_4_test_api            = "${aws_apigatewayv2_api.backend.api_endpoint}/health"
  }
}
