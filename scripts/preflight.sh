#!/bin/bash
# Pre-flight: provision AWS infrastructure (team tier - ECS Fargate + RDS private VPC + ElastiCache Redis)
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
APP_NAME="exponential"

echo "=== Pre-flight Infrastructure Setup (AWS - team tier) ==="
echo "Region: $REGION"

# 1. VPC and subnets
echo ""
echo "--- VPC ---"
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=${APP_NAME}-vpc" \
  --query 'Vpcs[0].VpcId' --output text --region $REGION 2>/dev/null)
if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  VPC_ID=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --region $REGION \
    --query 'Vpc.VpcId' --output text)
  aws ec2 create-tags --resources $VPC_ID --tags "Key=Name,Value=${APP_NAME}-vpc" --region $REGION
  aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames --region $REGION
  echo "VPC created: $VPC_ID"
else
  echo "VPC exists: $VPC_ID"
fi

# Public subnets (ALB)
PUB_SUBNET_A=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 \
  --availability-zone ${REGION}a --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
  aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-pub-a" \
  --query 'Subnets[0].SubnetId' --output text --region $REGION)
aws ec2 create-tags --resources $PUB_SUBNET_A --tags "Key=Name,Value=${APP_NAME}-pub-a" --region $REGION 2>/dev/null || true

PUB_SUBNET_B=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 \
  --availability-zone ${REGION}b --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
  aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-pub-b" \
  --query 'Subnets[0].SubnetId' --output text --region $REGION)
aws ec2 create-tags --resources $PUB_SUBNET_B --tags "Key=Name,Value=${APP_NAME}-pub-b" --region $REGION 2>/dev/null || true

# Private subnets (Fargate + RDS + ElastiCache)
PRIV_SUBNET_A=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.11.0/24 \
  --availability-zone ${REGION}a --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
  aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-priv-a" \
  --query 'Subnets[0].SubnetId' --output text --region $REGION)
aws ec2 create-tags --resources $PRIV_SUBNET_A --tags "Key=Name,Value=${APP_NAME}-priv-a" --region $REGION 2>/dev/null || true

PRIV_SUBNET_B=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.12.0/24 \
  --availability-zone ${REGION}b --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
  aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-priv-b" \
  --query 'Subnets[0].SubnetId' --output text --region $REGION)
aws ec2 create-tags --resources $PRIV_SUBNET_B --tags "Key=Name,Value=${APP_NAME}-priv-b" --region $REGION 2>/dev/null || true

# Internet gateway for public subnets
IGW_ID=$(aws ec2 describe-internet-gateways \
  --filters "Name=attachment.vpc-id,Values=$VPC_ID" \
  --query 'InternetGateways[0].InternetGatewayId' --output text --region $REGION)
if [ "$IGW_ID" = "None" ] || [ -z "$IGW_ID" ]; then
  IGW_ID=$(aws ec2 create-internet-gateway --region $REGION --query 'InternetGateway.InternetGatewayId' --output text)
  aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID --region $REGION
fi
PUB_RTB=$(aws ec2 create-route-table --vpc-id $VPC_ID --region $REGION --query 'RouteTable.RouteTableId' --output text 2>/dev/null || \
  aws ec2 describe-route-tables --filters "Name=tag:Name,Values=${APP_NAME}-pub-rtb" \
  --query 'RouteTables[0].RouteTableId' --output text --region $REGION)
aws ec2 create-route --route-table-id $PUB_RTB --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID --region $REGION 2>/dev/null || true
aws ec2 create-tags --resources $PUB_RTB --tags "Key=Name,Value=${APP_NAME}-pub-rtb" --region $REGION 2>/dev/null || true
aws ec2 associate-route-table --route-table-id $PUB_RTB --subnet-id $PUB_SUBNET_A --region $REGION 2>/dev/null || true
aws ec2 associate-route-table --route-table-id $PUB_RTB --subnet-id $PUB_SUBNET_B --region $REGION 2>/dev/null || true

# NAT Gateway for private subnets (Fargate needs outbound internet)
echo ""
echo "--- NAT Gateway ---"
EIP_ALLOC=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=${APP_NAME}-nat-eip" \
  --query 'Addresses[0].AllocationId' --output text --region $REGION 2>/dev/null)
if [ "$EIP_ALLOC" = "None" ] || [ -z "$EIP_ALLOC" ]; then
  EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --region $REGION --query 'AllocationId' --output text)
  aws ec2 create-tags --resources $EIP_ALLOC --tags "Key=Name,Value=${APP_NAME}-nat-eip" --region $REGION
fi
NAT_GW=$(aws ec2 describe-nat-gateways \
  --filter "Name=tag:Name,Values=${APP_NAME}-nat" "Name=state,Values=available" \
  --query 'NatGateways[0].NatGatewayId' --output text --region $REGION 2>/dev/null)
if [ "$NAT_GW" = "None" ] || [ -z "$NAT_GW" ]; then
  NAT_GW=$(aws ec2 create-nat-gateway --subnet-id $PUB_SUBNET_A --allocation-id $EIP_ALLOC \
    --region $REGION --query 'NatGateway.NatGatewayId' --output text)
  aws ec2 create-tags --resources $NAT_GW --tags "Key=Name,Value=${APP_NAME}-nat" --region $REGION
  echo "Waiting for NAT Gateway..."
  aws ec2 wait nat-gateway-available --nat-gateway-ids $NAT_GW --region $REGION
fi
PRIV_RTB=$(aws ec2 create-route-table --vpc-id $VPC_ID --region $REGION --query 'RouteTable.RouteTableId' --output text 2>/dev/null || \
  aws ec2 describe-route-tables --filters "Name=tag:Name,Values=${APP_NAME}-priv-rtb" \
  --query 'RouteTables[0].RouteTableId' --output text --region $REGION)
aws ec2 create-route --route-table-id $PRIV_RTB --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT_GW --region $REGION 2>/dev/null || true
aws ec2 create-tags --resources $PRIV_RTB --tags "Key=Name,Value=${APP_NAME}-priv-rtb" --region $REGION 2>/dev/null || true
aws ec2 associate-route-table --route-table-id $PRIV_RTB --subnet-id $PRIV_SUBNET_A --region $REGION 2>/dev/null || true
aws ec2 associate-route-table --route-table-id $PRIV_RTB --subnet-id $PRIV_SUBNET_B --region $REGION 2>/dev/null || true
echo "VPC networking ready"

# 2. Security groups
echo ""
echo "--- Security Groups ---"
DB_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${APP_NAME}-db-sg" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text --region $REGION 2>/dev/null)
if [ "$DB_SG" = "None" ] || [ -z "$DB_SG" ]; then
  DB_SG=$(aws ec2 create-security-group --group-name "${APP_NAME}-db-sg" \
    --description "RDS - allow Fargate tasks only" --vpc-id $VPC_ID \
    --query 'GroupId' --output text --region $REGION)
fi

REDIS_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${APP_NAME}-redis-sg" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text --region $REGION 2>/dev/null)
if [ "$REDIS_SG" = "None" ] || [ -z "$REDIS_SG" ]; then
  REDIS_SG=$(aws ec2 create-security-group --group-name "${APP_NAME}-redis-sg" \
    --description "ElastiCache - allow Fargate tasks only" --vpc-id $VPC_ID \
    --query 'GroupId' --output text --region $REGION)
fi

APP_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${APP_NAME}-app-sg" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text --region $REGION 2>/dev/null)
if [ "$APP_SG" = "None" ] || [ -z "$APP_SG" ]; then
  APP_SG=$(aws ec2 create-security-group --group-name "${APP_NAME}-app-sg" \
    --description "Fargate tasks" --vpc-id $VPC_ID \
    --query 'GroupId' --output text --region $REGION)
  aws ec2 authorize-security-group-ingress --group-id $APP_SG \
    --protocol tcp --port 3015 --source-group $APP_SG --region $REGION 2>/dev/null || true
fi

ALB_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${APP_NAME}-alb-sg" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text --region $REGION 2>/dev/null)
if [ "$ALB_SG" = "None" ] || [ -z "$ALB_SG" ]; then
  ALB_SG=$(aws ec2 create-security-group --group-name "${APP_NAME}-alb-sg" \
    --description "ALB - allow public HTTP/HTTPS" --vpc-id $VPC_ID \
    --query 'GroupId' --output text --region $REGION)
  aws ec2 authorize-security-group-ingress --group-id $ALB_SG \
    --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
  aws ec2 authorize-security-group-ingress --group-id $ALB_SG \
    --protocol tcp --port 443 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
fi

# Allow ALB → Fargate
aws ec2 authorize-security-group-ingress --group-id $APP_SG \
  --protocol tcp --port 3015 --source-group $ALB_SG --region $REGION 2>/dev/null || true
# Allow Fargate → RDS
aws ec2 authorize-security-group-ingress --group-id $DB_SG \
  --protocol tcp --port 5432 --source-group $APP_SG --region $REGION 2>/dev/null || true
# Allow Fargate → Redis
aws ec2 authorize-security-group-ingress --group-id $REDIS_SG \
  --protocol tcp --port 6379 --source-group $APP_SG --region $REGION 2>/dev/null || true
echo "Security groups ready: DB=$DB_SG REDIS=$REDIS_SG APP=$APP_SG ALB=$ALB_SG"

# 3. RDS Postgres (private subnet)
echo ""
echo "--- RDS Postgres (private) ---"
DB_SUBNET_GROUP="${APP_NAME}-db-subnet"
aws rds create-db-subnet-group \
  --db-subnet-group-name $DB_SUBNET_GROUP \
  --db-subnet-group-description "Private subnets for ${APP_NAME} RDS" \
  --subnet-ids $PRIV_SUBNET_A $PRIV_SUBNET_B \
  --region $REGION 2>/dev/null || true

if aws rds describe-db-instances --db-instance-identifier ${APP_NAME}-db --region $REGION 2>/dev/null | grep -q "available"; then
  echo "RDS instance already exists."
else
  aws rds create-db-instance \
    --db-instance-identifier ${APP_NAME}-db \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --engine-version 15 \
    --master-username postgres \
    --master-user-password "${DB_PASSWORD:?Set DB_PASSWORD in .env}" \
    --allocated-storage 20 \
    --no-publicly-accessible \
    --db-subnet-group-name $DB_SUBNET_GROUP \
    --vpc-security-group-ids $DB_SG \
    --backup-retention-period 7 \
    --region $REGION \
    --no-multi-az \
    --storage-type gp3
  echo "Waiting for RDS (~5-10 min)..."
  aws rds wait db-instance-available --db-instance-identifier ${APP_NAME}-db --region $REGION
fi
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier ${APP_NAME}-db \
  --region $REGION --query 'DBInstances[0].Endpoint.Address' --output text)
echo "RDS Endpoint (private): $RDS_ENDPOINT"
grep -q '^DATABASE_URL=' .env || echo "DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/${APP_NAME}" >> .env
grep -q '^DB_SSL=' .env || echo "DB_SSL=true" >> .env

# 4. ElastiCache Redis (private subnet)
echo ""
echo "--- ElastiCache Redis (private) ---"
REDIS_SUBNET_GROUP="${APP_NAME}-redis-subnet"
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name $REDIS_SUBNET_GROUP \
  --cache-subnet-group-description "Private subnets for ${APP_NAME} Redis" \
  --subnet-ids $PRIV_SUBNET_A $PRIV_SUBNET_B \
  --region $REGION 2>/dev/null || true

if aws elasticache describe-cache-clusters --cache-cluster-id ${APP_NAME}-redis --region $REGION 2>/dev/null | grep -q "available"; then
  echo "ElastiCache Redis already exists."
else
  aws elasticache create-cache-cluster \
    --cache-cluster-id ${APP_NAME}-redis \
    --cache-node-type cache.t3.micro \
    --engine redis \
    --num-cache-nodes 1 \
    --cache-subnet-group-name $REDIS_SUBNET_GROUP \
    --security-group-ids $REDIS_SG \
    --region $REGION
  echo "Waiting for ElastiCache Redis (~5 min)..."
  aws elasticache wait cache-cluster-available --cache-cluster-id ${APP_NAME}-redis --region $REGION
fi
REDIS_ENDPOINT=$(aws elasticache describe-cache-clusters --cache-cluster-id ${APP_NAME}-redis \
  --show-cache-node-info --region $REGION \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' --output text)
REDIS_PORT=$(aws elasticache describe-cache-clusters --cache-cluster-id ${APP_NAME}-redis \
  --show-cache-node-info --region $REGION \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Port' --output text)
echo "Redis Endpoint (private): $REDIS_ENDPOINT:$REDIS_PORT"
grep -q '^REDIS_URL=' .env || echo "REDIS_URL=redis://${REDIS_ENDPOINT}:${REDIS_PORT}" >> .env

# 5. S3 Bucket (file attachments, avatars)
echo ""
echo "--- S3 Bucket ---"
BUCKET_NAME="${APP_NAME}-assets-${REGION}"
if aws s3api head-bucket --bucket $BUCKET_NAME --region $REGION 2>/dev/null; then
  echo "S3 bucket exists: $BUCKET_NAME"
else
  aws s3api create-bucket --bucket $BUCKET_NAME --region $REGION \
    --create-bucket-configuration LocationConstraint=$REGION 2>/dev/null || \
    aws s3api create-bucket --bucket $BUCKET_NAME --region $REGION
  aws s3api put-bucket-cors --bucket $BUCKET_NAME --region $REGION --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }]
  }'
  echo "S3 bucket created: $BUCKET_NAME"
fi
grep -q '^S3_BUCKET=' .env || echo "S3_BUCKET=$BUCKET_NAME" >> .env
grep -q '^AWS_REGION=' .env || echo "AWS_REGION=$REGION" >> .env

# 6. ECR Repository
echo ""
echo "--- ECR Repository ---"
aws ecr describe-repositories --repository-names $APP_NAME --region $REGION 2>/dev/null || \
  aws ecr create-repository --repository-name $APP_NAME --region $REGION
echo "ECR repo ready: $APP_NAME"

# 7. ECS Cluster
echo ""
echo "--- ECS Cluster ---"
aws ecs describe-clusters --clusters ${APP_NAME}-cluster --region $REGION \
  --query 'clusters[?status==`ACTIVE`].clusterName' --output text | grep -q $APP_NAME || \
  aws ecs create-cluster --cluster-name ${APP_NAME}-cluster --region $REGION
echo "ECS cluster ready: ${APP_NAME}-cluster"

# 8. ALB (Application Load Balancer)
echo ""
echo "--- Application Load Balancer ---"
ALB_ARN=$(aws elbv2 describe-load-balancers --names ${APP_NAME}-alb --region $REGION \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null)
if [ "$ALB_ARN" = "None" ] || [ -z "$ALB_ARN" ]; then
  ALB_ARN=$(aws elbv2 create-load-balancer --name ${APP_NAME}-alb \
    --subnets $PUB_SUBNET_A $PUB_SUBNET_B \
    --security-groups $ALB_SG \
    --scheme internet-facing \
    --type application \
    --region $REGION \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  echo "ALB created: $ALB_ARN"
else
  echo "ALB exists: $ALB_ARN"
fi

# Target group
TG_ARN=$(aws elbv2 describe-target-groups --names ${APP_NAME}-tg --region $REGION \
  --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null)
if [ "$TG_ARN" = "None" ] || [ -z "$TG_ARN" ]; then
  TG_ARN=$(aws elbv2 create-target-group --name ${APP_NAME}-tg \
    --protocol HTTP --port 3015 --vpc-id $VPC_ID \
    --target-type ip \
    --health-check-path "/api/health" \
    --health-check-interval-seconds 30 \
    --region $REGION \
    --query 'TargetGroups[0].TargetGroupArn' --output text)
  echo "Target group created: $TG_ARN"
fi

# HTTP listener (80 → target group)
aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN --region $REGION \
  --query 'Listeners[?Port==`80`].ListenerArn' --output text | grep -q "arn:" || \
  aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
    --protocol HTTP --port 80 \
    --default-actions "Type=forward,TargetGroupArn=$TG_ARN" \
    --region $REGION

ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --region $REGION \
  --query 'LoadBalancers[0].DNSName' --output text)
grep -q '^ALB_DNS=' .env || echo "ALB_DNS=$ALB_DNS" >> .env
grep -q '^ALB_ARN=' .env || echo "ALB_ARN=$ALB_ARN" >> .env
grep -q '^TG_ARN=' .env || echo "TG_ARN=$TG_ARN" >> .env

# 9. SES (email - magic links, notifications)
echo ""
echo "--- SES Sender Identity ---"
SES_IDENTITY="${SES_IDENTITY:-${SENDER_EMAIL:-}}"
if [ -n "$SES_IDENTITY" ]; then
  if aws sesv2 get-email-identity --email-identity "$SES_IDENTITY" --region $REGION >/dev/null 2>&1; then
    STATUS=$(aws sesv2 get-email-identity --email-identity "$SES_IDENTITY" --region $REGION --query 'VerificationStatus' --output text)
    echo "Using existing SES identity: $SES_IDENTITY ($STATUS)"
  else
    aws sesv2 create-email-identity --email-identity "$SES_IDENTITY" --region $REGION 2>/dev/null || true
    echo "Created SES identity: $SES_IDENTITY - check your email to verify."
  fi
else
  echo "No SES_IDENTITY set - skipping email setup. Set SENDER_EMAIL in .env to enable."
fi

echo ""
echo "=== Pre-flight Complete (team tier) ==="
echo "VPC: $VPC_ID | App SG: $APP_SG | DB SG: $DB_SG | Redis SG: $REDIS_SG | ALB SG: $ALB_SG"
echo "Private subnets: $PRIV_SUBNET_A, $PRIV_SUBNET_B"
echo "ALB DNS: $ALB_DNS"
echo "Deploy target: ECS Fargate + ALB (docker build → ECR → ECS service)"

# Store infrastructure IDs in .env
grep -q '^PRIV_SUBNET_A=' .env || echo "PRIV_SUBNET_A=$PRIV_SUBNET_A" >> .env
grep -q '^PRIV_SUBNET_B=' .env || echo "PRIV_SUBNET_B=$PRIV_SUBNET_B" >> .env
grep -q '^PUB_SUBNET_A=' .env || echo "PUB_SUBNET_A=$PUB_SUBNET_A" >> .env
grep -q '^PUB_SUBNET_B=' .env || echo "PUB_SUBNET_B=$PUB_SUBNET_B" >> .env
grep -q '^APP_SG=' .env || echo "APP_SG=$APP_SG" >> .env
grep -q '^DB_SG=' .env || echo "DB_SG=$DB_SG" >> .env
grep -q '^REDIS_SG=' .env || echo "REDIS_SG=$REDIS_SG" >> .env
grep -q '^ALB_SG=' .env || echo "ALB_SG=$ALB_SG" >> .env
grep -q '^VPC_ID=' .env || echo "VPC_ID=$VPC_ID" >> .env
