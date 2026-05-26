#!/bin/bash
set -e

echo "Deploying Revideo Render Worker to AWS Lambda"

# Variables
AWS_REGION=$(aws configure get region || echo "us-east-1")
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO_NAME="revideo-render-worker"
FUNCTION_NAME="revideo-render-lambda"
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:latest"

echo "1. Authenticating Docker to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

echo "2. Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names $REPO_NAME --region $AWS_REGION || aws ecr create-repository --repository-name $REPO_NAME --region $AWS_REGION

echo "3. Building Docker image..."
# Build the typescript files
npm ci
npm run build

# Build docker image without provenance attestations which break AWS Lambda
docker build --provenance=false --platform linux/amd64 -t $REPO_NAME .
docker tag $REPO_NAME:latest $IMAGE_URI

echo "4. Pushing Docker image to ECR..."
docker push $IMAGE_URI

echo "5. Updating or Creating Lambda function..."
if aws lambda get-function --function-name $FUNCTION_NAME --region $AWS_REGION > /dev/null 2>&1; then
    echo "Function exists. Updating image..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --image-uri $IMAGE_URI \
        --region $AWS_REGION
else
    echo "Creating new Lambda function..."
    # Note: Requires an execution role. Please ensure you have created a basic Lambda execution role that also has S3 PutObject access to your GCS/S3 bucket.
    echo "ERROR: Function does not exist. Please create the function manually in the AWS console first using the pushed ECR image,"
    echo "configure it with 3008 MB of Memory (or request a quota increase for up to 10240 MB), a 15-minute timeout, and an appropriate IAM role, and then run this script to update it."
    exit 1
fi

echo "✅ Deployment triggered successfully!"
