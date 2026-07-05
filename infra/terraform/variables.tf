variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "s3_bucket_name" {
  description = "S3 bucket name for uploads and frontend assets"
  type        = string
  default     = "ecolens-uploads-example"
}

variable "frontend_bucket_name" {
  description = "S3 bucket name for the static frontend"
  type        = string
  default     = "ecolens-frontend-example"
}

variable "project_prefix" {
  description = "Prefix for resource names"
  type        = string
  default     = "ecolens"
}

variable "cognito_userpool_id" {
  description = "Cognito User Pool ID used by the API Lambda"
  type        = string
  default     = ""
}

variable "cognito_app_client_id" {
  description = "Cognito App Client ID used by the API Lambda"
  type        = string
  default     = ""
}

variable "model_version" {
  description = "Logical model version used to select S3 artifacts"
  type        = string
  default     = "v1"
}

variable "frontend_origin" {
  description = "CloudFront distribution URL for CORS allow-list (e.g. https://d123abc.cloudfront.net)"
  type        = string
  default     = ""
}

variable "model_s3_key" {
  description = "S3 key for the species model artifact"
  type        = string
  default     = "models/model.pt"
}

variable "model_labels_s3_key" {
  description = "S3 key for the model labels artifact"
  type        = string
  default     = "models/labels.txt"
}

variable "megadetector_s3_key" {
  description = "S3 key for the MegaDetector artifact"
  type        = string
  default     = "models/mdv5a.pt"
}

variable "megadetector_confidence_threshold" {
  description = "Minimum confidence required for MegaDetector crops"
  type        = string
  default     = "0.05"
}

variable "megadetector_category" {
  description = "MegaDetector category representing animals"
  type        = string
  default     = "1"
}

variable "oci_nosql_table_name" {
  description = "OCI NoSQL table name for metadata"
  type        = string
  default     = ""
}

variable "oci_nosql_compartment_ocid" {
  description = "OCI NoSQL compartment OCID"
  type        = string
  default     = ""
}

variable "oci_endpoint" {
  description = "Optional OCI NoSQL service endpoint override"
  type        = string
  default     = ""
}

variable "oci_private_key_content" {
  description = "Optional OCI API private key content for Lambda"
  type        = string
  default     = ""
}

variable "oci_passphrase" {
  description = "Optional OCI API private key passphrase"
  type        = string
  default     = ""
}

variable "oci_region" {
  description = "OCI region"
  type        = string
  default     = "us-ashburn-1"
}

variable "oci_tenancy_ocid" { type = string }
variable "oci_user_ocid" { type = string }
variable "oci_fingerprint" { type = string }
variable "oci_private_key_path" { type = string }
// OCI NoSQL configuration
variable "oci_nosql_read_units" {
  description = "Max read units for OCI NoSQL table"
  type        = number
  default     = 10
}

variable "oci_nosql_write_units" {
  description = "Max write units for OCI NoSQL table"
  type        = number
  default     = 10
}

variable "oci_nosql_storage_gbs" {
  description = "Max storage in GB for OCI NoSQL table"
  type        = number
  default     = 10
}