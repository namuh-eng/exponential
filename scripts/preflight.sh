#!/bin/bash
# Pre-flight: provision AWS infrastructure (team tier - ECS Fargate + RDS private VPC + ElastiCache Redis)
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
export ENV_FILE
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

REGION="${AWS_REGION:-us-east-1}"
APP_NAME="exponential"

normalize_bool() {
  case "${1,,}" in
    true|1|yes|y|on) printf 'true' ;;
    false|0|no|n|off) printf 'false' ;;
    *)
      echo "Invalid boolean value: $1" >&2
      echo "Use true or false." >&2
      exit 1
      ;;
  esac
}

set_env_file() {
  local key="$1"
  local value="$2"
  KEY="$key" VALUE="$value" python3 - <<'PY'
from pathlib import Path
import os

path = Path(os.environ.get("ENV_FILE", ".env"))
key = os.environ["KEY"]
value = os.environ["VALUE"]
lines = path.read_text().splitlines() if path.exists() else []
for index, line in enumerate(lines):
    if line.startswith(f"{key}="):
        lines[index] = f"{key}={value}"
        break
else:
    lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n")
PY
}

DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t3.micro}"
DB_MULTI_AZ="$(normalize_bool "${DB_MULTI_AZ:-false}")"
REDIS_NODE_TYPE="${REDIS_NODE_TYPE:-cache.t3.micro}"
REDIS_REPLICATION_ENABLED="$(normalize_bool "${REDIS_REPLICATION_ENABLED:-false}")"

echo "=== Pre-flight Infrastructure Setup (AWS - team tier) ==="
echo "Region: $REGION"
echo "Data tier: RDS $DB_INSTANCE_CLASS multi-AZ=$DB_MULTI_AZ | Redis $REDIS_NODE_TYPE replication=$REDIS_REPLICATION_ENABLED"

# 1. VPC and subnets
echo ""
echo "--- VPC ---"
if [ -n "${VPC_ID:-}" ]; then
  echo "Using VPC from environment: $VPC_ID"
else
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
fi

# Public subnets (ALB). If subnet ids are supplied in .env, reuse them and
# do not retag or re-associate shared infrastructure.
if [ -z "${PUB_SUBNET_A:-}" ]; then
  PUB_SUBNET_A=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 \
    --availability-zone ${REGION}a --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
    aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-pub-a" \
    --query 'Subnets[0].SubnetId' --output text --region $REGION)
  aws ec2 create-tags --resources $PUB_SUBNET_A --tags "Key=Name,Value=${APP_NAME}-pub-a" --region $REGION 2>/dev/null || true
fi

if [ -z "${PUB_SUBNET_B:-}" ]; then
  PUB_SUBNET_B=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 \
    --availability-zone ${REGION}b --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
    aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-pub-b" \
    --query 'Subnets[0].SubnetId' --output text --region $REGION)
  aws ec2 create-tags --resources $PUB_SUBNET_B --tags "Key=Name,Value=${APP_NAME}-pub-b" --region $REGION 2>/dev/null || true
fi

# Private subnets (Fargate + RDS + ElastiCache)
if [ -z "${PRIV_SUBNET_A:-}" ]; then
  PRIV_SUBNET_A=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.11.0/24 \
    --availability-zone ${REGION}a --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
    aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-priv-a" \
    --query 'Subnets[0].SubnetId' --output text --region $REGION)
  aws ec2 create-tags --resources $PRIV_SUBNET_A --tags "Key=Name,Value=${APP_NAME}-priv-a" --region $REGION 2>/dev/null || true
fi

if [ -z "${PRIV_SUBNET_B:-}" ]; then
  PRIV_SUBNET_B=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.12.0/24 \
    --availability-zone ${REGION}b --query 'Subnet.SubnetId' --output text --region $REGION 2>/dev/null || \
    aws ec2 describe-subnets --filters "Name=tag:Name,Values=${APP_NAME}-priv-b" \
    --query 'Subnets[0].SubnetId' --output text --region $REGION)
  aws ec2 create-tags --resources $PRIV_SUBNET_B --tags "Key=Name,Value=${APP_NAME}-priv-b" --region $REGION 2>/dev/null || true
fi

# Internet gateway for public subnets
IGW_ID=$(aws ec2 describe-internet-gateways \
  --filters "Name=attachment.vpc-id,Values=$VPC_ID" \
  --query 'InternetGateways[0].InternetGatewayId' --output text --region $REGION)
if [ "$IGW_ID" = "None" ] || [ -z "$IGW_ID" ]; then
  IGW_ID=$(aws ec2 create-internet-gateway --region $REGION --query 'InternetGateway.InternetGatewayId' --output text)
  aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID --region $REGION
fi
if [ -z "${PUB_RTB:-}" ]; then
  PUB_RTB=$(aws ec2 create-route-table --vpc-id $VPC_ID --region $REGION --query 'RouteTable.RouteTableId' --output text 2>/dev/null || \
    aws ec2 describe-route-tables --filters "Name=tag:Name,Values=${APP_NAME}-pub-rtb" \
    --query 'RouteTables[0].RouteTableId' --output text --region $REGION)
  aws ec2 create-route --route-table-id $PUB_RTB --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID --region $REGION 2>/dev/null || true
  aws ec2 create-tags --resources $PUB_RTB --tags "Key=Name,Value=${APP_NAME}-pub-rtb" --region $REGION 2>/dev/null || true
  aws ec2 associate-route-table --route-table-id $PUB_RTB --subnet-id $PUB_SUBNET_A --region $REGION 2>/dev/null || true
  aws ec2 associate-route-table --route-table-id $PUB_RTB --subnet-id $PUB_SUBNET_B --region $REGION 2>/dev/null || true
else
  echo "Using public route table from environment: $PUB_RTB"
fi

# NAT Gateway for private subnets (Fargate needs outbound internet)
echo ""
echo "--- NAT Gateway ---"
if [ -z "${NAT_GW:-}" ]; then
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
else
  echo "Using NAT Gateway from environment: $NAT_GW"
fi
if [ -z "${PRIV_RTB:-}" ]; then
  PRIV_RTB=$(aws ec2 create-route-table --vpc-id $VPC_ID --region $REGION --query 'RouteTable.RouteTableId' --output text 2>/dev/null || \
    aws ec2 describe-route-tables --filters "Name=tag:Name,Values=${APP_NAME}-priv-rtb" \
    --query 'RouteTables[0].RouteTableId' --output text --region $REGION)
  aws ec2 create-route --route-table-id $PRIV_RTB --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT_GW --region $REGION 2>/dev/null || true
  aws ec2 create-tags --resources $PRIV_RTB --tags "Key=Name,Value=${APP_NAME}-priv-rtb" --region $REGION 2>/dev/null || true
  aws ec2 associate-route-table --route-table-id $PRIV_RTB --subnet-id $PRIV_SUBNET_A --region $REGION 2>/dev/null || true
  aws ec2 associate-route-table --route-table-id $PRIV_RTB --subnet-id $PRIV_SUBNET_B --region $REGION 2>/dev/null || true
else
  echo "Using private route table from environment: $PRIV_RTB"
fi
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

# Allow ALB → Fargate split services (web, api)
for PORT in 3000 7015 7016; do
  aws ec2 authorize-security-group-ingress --group-id $APP_SG \
    --protocol tcp --port $PORT --source-group $ALB_SG --region $REGION 2>/dev/null || true
done
# Allow Fargate services to call each other on private service ports.
for PORT in 7016; do
  aws ec2 authorize-security-group-ingress --group-id $APP_SG \
    --protocol tcp --port $PORT --source-group $APP_SG --region $REGION 2>/dev/null || true
done
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

if RDS_INFO=$(aws rds describe-db-instances --db-instance-identifier ${APP_NAME}-db \
  --region $REGION \
  --query 'DBInstances[0].[DBInstanceStatus,DBInstanceClass,MultiAZ]' --output text 2>/dev/null); then
  read -r RDS_STATUS RDS_CLASS RDS_MULTI_AZ_CURRENT <<< "$RDS_INFO"
  if [ "$RDS_STATUS" != "available" ]; then
    echo "Waiting for existing RDS instance to become available..."
    aws rds wait db-instance-available --db-instance-identifier ${APP_NAME}-db --region $REGION
    RDS_INFO=$(aws rds describe-db-instances --db-instance-identifier ${APP_NAME}-db \
      --region $REGION \
      --query 'DBInstances[0].[DBInstanceStatus,DBInstanceClass,MultiAZ]' --output text)
    read -r RDS_STATUS RDS_CLASS RDS_MULTI_AZ_CURRENT <<< "$RDS_INFO"
  fi

  RDS_MULTI_AZ_CURRENT="$(normalize_bool "$RDS_MULTI_AZ_CURRENT")"
  RDS_MODIFY_ARGS=()
  if [ "$RDS_CLASS" != "$DB_INSTANCE_CLASS" ]; then
    RDS_MODIFY_ARGS+=(--db-instance-class "$DB_INSTANCE_CLASS")
  fi
  if [ "$RDS_MULTI_AZ_CURRENT" != "$DB_MULTI_AZ" ]; then
    if [ "$DB_MULTI_AZ" = "true" ]; then
      RDS_MODIFY_ARGS+=(--multi-az)
    else
      RDS_MODIFY_ARGS+=(--no-multi-az)
    fi
  fi

  if [ "${#RDS_MODIFY_ARGS[@]}" -gt 0 ]; then
    echo "Reconciling RDS instance: class=$DB_INSTANCE_CLASS multi-AZ=$DB_MULTI_AZ"
    aws rds modify-db-instance \
      --db-instance-identifier ${APP_NAME}-db \
      "${RDS_MODIFY_ARGS[@]}" \
      --apply-immediately \
      --region $REGION
    echo "Waiting for RDS modification..."
    aws rds wait db-instance-available --db-instance-identifier ${APP_NAME}-db --region $REGION
  else
    echo "RDS instance already matches requested data-tier settings."
  fi
else
  RDS_MULTI_AZ_CREATE_ARG="--no-multi-az"
  if [ "$DB_MULTI_AZ" = "true" ]; then
    RDS_MULTI_AZ_CREATE_ARG="--multi-az"
  fi
  aws rds create-db-instance \
    --db-instance-identifier ${APP_NAME}-db \
    --db-instance-class "$DB_INSTANCE_CLASS" \
    --engine postgres \
    --engine-version 15 \
    --master-username postgres \
    --master-user-password "${DB_PASSWORD:?Set DB_PASSWORD in .env}" \
    --db-name "${APP_NAME}" \
    --allocated-storage 20 \
    --no-publicly-accessible \
    --db-subnet-group-name $DB_SUBNET_GROUP \
    --vpc-security-group-ids $DB_SG \
    --backup-retention-period 7 \
    --region $REGION \
    "$RDS_MULTI_AZ_CREATE_ARG" \
    --storage-type gp3
  echo "Waiting for RDS (~5-10 min)..."
  aws rds wait db-instance-available --db-instance-identifier ${APP_NAME}-db --region $REGION
fi
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier ${APP_NAME}-db \
  --region $REGION --query 'DBInstances[0].Endpoint.Address' --output text)
echo "RDS Endpoint (private): $RDS_ENDPOINT"
if [ -n "${DB_PASSWORD:-}" ]; then
  set_env_file DATABASE_URL "postgresql://postgres:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/${APP_NAME}"
elif grep -q '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null; then
  echo "DATABASE_URL already exists; leaving it unchanged because DB_PASSWORD is not set."
else
  echo "Set DB_PASSWORD so preflight can write DATABASE_URL." >&2
  exit 1
fi
set_env_file DB_SSL "true"

# 4. ElastiCache Redis (private subnet)
echo ""
echo "--- ElastiCache Redis (private) ---"
REDIS_SUBNET_GROUP="${APP_NAME}-redis-subnet"
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name $REDIS_SUBNET_GROUP \
  --cache-subnet-group-description "Private subnets for ${APP_NAME} Redis" \
  --subnet-ids $PRIV_SUBNET_A $PRIV_SUBNET_B \
  --region $REGION 2>/dev/null || true

if [ "$REDIS_REPLICATION_ENABLED" = "true" ]; then
  REDIS_REPLICATION_GROUP="${APP_NAME}-redis-rg"
  if aws elasticache describe-replication-groups --replication-group-id $REDIS_REPLICATION_GROUP --region $REGION >/dev/null 2>&1; then
    REDIS_INFO=$(aws elasticache describe-replication-groups --replication-group-id $REDIS_REPLICATION_GROUP \
      --region $REGION \
      --query 'ReplicationGroups[0].[Status,AutomaticFailover,MultiAZ,MemberClusters[0]]' --output text)
    read -r REDIS_STATUS REDIS_AUTOMATIC_FAILOVER REDIS_MULTI_AZ_CURRENT REDIS_MEMBER_CLUSTER <<< "$REDIS_INFO"
    if [ "$REDIS_STATUS" != "available" ]; then
      echo "Waiting for existing ElastiCache replication group to become available..."
      aws elasticache wait replication-group-available --replication-group-id $REDIS_REPLICATION_GROUP --region $REGION
      REDIS_INFO=$(aws elasticache describe-replication-groups --replication-group-id $REDIS_REPLICATION_GROUP \
        --region $REGION \
        --query 'ReplicationGroups[0].[Status,AutomaticFailover,MultiAZ,MemberClusters[0]]' --output text)
      read -r REDIS_STATUS REDIS_AUTOMATIC_FAILOVER REDIS_MULTI_AZ_CURRENT REDIS_MEMBER_CLUSTER <<< "$REDIS_INFO"
    fi

    REDIS_CURRENT_NODE_TYPE=$(aws elasticache describe-cache-clusters --cache-cluster-id "$REDIS_MEMBER_CLUSTER" \
      --region $REGION \
      --query 'CacheClusters[0].CacheNodeType' --output text)
    REDIS_MODIFY_ARGS=()
    if [ "$REDIS_CURRENT_NODE_TYPE" != "$REDIS_NODE_TYPE" ]; then
      REDIS_MODIFY_ARGS+=(--cache-node-type "$REDIS_NODE_TYPE")
    fi
    if [ "$REDIS_AUTOMATIC_FAILOVER" != "enabled" ]; then
      REDIS_MODIFY_ARGS+=(--automatic-failover-enabled)
    fi
    if [ "$REDIS_MULTI_AZ_CURRENT" != "enabled" ]; then
      REDIS_MODIFY_ARGS+=(--multi-az-enabled)
    fi
    if [ "${#REDIS_MODIFY_ARGS[@]}" -gt 0 ]; then
      echo "Reconciling ElastiCache replication group: node type=$REDIS_NODE_TYPE failover=enabled"
      aws elasticache modify-replication-group \
        --replication-group-id $REDIS_REPLICATION_GROUP \
        "${REDIS_MODIFY_ARGS[@]}" \
        --apply-immediately \
        --region $REGION
      echo "Waiting for ElastiCache replication group modification..."
      aws elasticache wait replication-group-available --replication-group-id $REDIS_REPLICATION_GROUP --region $REGION
    else
      echo "ElastiCache replication group already matches requested data-tier settings."
    fi
  else
    aws elasticache create-replication-group \
      --replication-group-id $REDIS_REPLICATION_GROUP \
      --replication-group-description "Redis replication group for ${APP_NAME}" \
      --engine redis \
      --cache-node-type "$REDIS_NODE_TYPE" \
      --num-node-groups 1 \
      --replicas-per-node-group 1 \
      --automatic-failover-enabled \
      --multi-az-enabled \
      --cache-subnet-group-name $REDIS_SUBNET_GROUP \
      --security-group-ids $REDIS_SG \
      --region $REGION
    echo "Waiting for ElastiCache Redis replication group (~10-15 min)..."
    aws elasticache wait replication-group-available --replication-group-id $REDIS_REPLICATION_GROUP --region $REGION
  fi
  REDIS_ENDPOINT=$(aws elasticache describe-replication-groups --replication-group-id $REDIS_REPLICATION_GROUP \
    --region $REGION \
    --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' --output text)
  REDIS_PORT=$(aws elasticache describe-replication-groups --replication-group-id $REDIS_REPLICATION_GROUP \
    --region $REGION \
    --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Port' --output text)
else
  if REDIS_INFO=$(aws elasticache describe-cache-clusters --cache-cluster-id ${APP_NAME}-redis \
    --region $REGION \
    --query 'CacheClusters[0].[CacheClusterStatus,CacheNodeType]' --output text 2>/dev/null); then
    read -r REDIS_STATUS REDIS_CURRENT_NODE_TYPE <<< "$REDIS_INFO"
    if [ "$REDIS_STATUS" != "available" ]; then
      echo "Waiting for existing ElastiCache Redis cluster to become available..."
      aws elasticache wait cache-cluster-available --cache-cluster-id ${APP_NAME}-redis --region $REGION
      REDIS_INFO=$(aws elasticache describe-cache-clusters --cache-cluster-id ${APP_NAME}-redis \
        --region $REGION \
        --query 'CacheClusters[0].[CacheClusterStatus,CacheNodeType]' --output text)
      read -r REDIS_STATUS REDIS_CURRENT_NODE_TYPE <<< "$REDIS_INFO"
    fi
    if [ "$REDIS_CURRENT_NODE_TYPE" != "$REDIS_NODE_TYPE" ]; then
      echo "Reconciling ElastiCache Redis node type: $REDIS_NODE_TYPE"
      aws elasticache modify-cache-cluster \
        --cache-cluster-id ${APP_NAME}-redis \
        --cache-node-type "$REDIS_NODE_TYPE" \
        --apply-immediately \
        --region $REGION
      echo "Waiting for ElastiCache Redis modification..."
      aws elasticache wait cache-cluster-available --cache-cluster-id ${APP_NAME}-redis --region $REGION
    else
      echo "ElastiCache Redis cluster already matches requested data-tier settings."
    fi
  else
    aws elasticache create-cache-cluster \
      --cache-cluster-id ${APP_NAME}-redis \
      --cache-node-type "$REDIS_NODE_TYPE" \
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
fi
echo "Redis Endpoint (private): $REDIS_ENDPOINT:$REDIS_PORT"
set_env_file REDIS_URL "redis://${REDIS_ENDPOINT}:${REDIS_PORT}"

# 5. Object storage (file attachments, avatars)
echo ""
echo "--- Object Storage ---"
if [ -n "${S3_ENDPOINT:-}" ]; then
  echo "Using external S3-compatible storage at ${S3_ENDPOINT} (bucket ${S3_BUCKET:-unset}); skipping AWS S3 bucket creation."
else
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
  grep -q '^S3_BUCKET=' "$ENV_FILE" || echo "S3_BUCKET=$BUCKET_NAME" >> "$ENV_FILE"
fi
grep -q '^AWS_REGION=' "$ENV_FILE" || echo "AWS_REGION=$REGION" >> "$ENV_FILE"

# 6. ECR Repositories
echo ""
echo "--- ECR Repositories ---"
for REPO in "${APP_NAME}-api" "${APP_NAME}-web" "${APP_NAME}-schema"; do
  aws ecr describe-repositories --repository-names $REPO --region $REGION 2>/dev/null || \
    aws ecr create-repository --repository-name $REPO --region $REGION
  echo "ECR repo ready: $REPO"
done

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
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
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
  aws elbv2 set-security-groups --load-balancer-arn "$ALB_ARN" \
    --security-groups "$ALB_SG" \
    --region $REGION >/dev/null
fi

create_target_group() {
  local name="$1"
  local port="$2"
  local health_path="$3"
  local matcher="${4:-200}"
  local arn
  arn=$(aws elbv2 describe-target-groups --names "$name" --region $REGION \
    --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
  if [ "$arn" = "None" ] || [ -z "$arn" ]; then
    arn=$(aws elbv2 create-target-group --name "$name" \
      --protocol HTTP --port "$port" --vpc-id $VPC_ID \
      --target-type ip \
      --health-check-path "$health_path" \
      --matcher "HttpCode=$matcher" \
      --health-check-interval-seconds 30 \
      --region $REGION \
      --query 'TargetGroups[0].TargetGroupArn' --output text)
    echo "Target group created: $name ($arn)" >&2
  else
    echo "Target group exists: $name ($arn)" >&2
    aws elbv2 modify-target-group --target-group-arn "$arn" \
      --health-check-path "$health_path" \
      --matcher "HttpCode=$matcher" \
      --region $REGION >/dev/null
  fi
  printf '%s' "$arn"
}

WEB_TG_ARN=$(create_target_group "${APP_NAME}-web-tg" 3000 "/" "200-399")
API_TG_ARN=$(create_target_group "${APP_NAME}-api-tg" 7016 "/healthz" "200")

# HTTPS listener wiring when ACM_CERT_ARN is provided.
# When set:
#   - Port 443 HTTPS listener carries forward rules (web default, /api/* to Go API).
#   - Port 80 HTTP listener becomes a permanent redirect to HTTPS.
# When not set:
#   - Port 80 HTTP listener carries all forward rules as before (plain HTTP).

HTTPS_LISTENER_ARN=""
if [ -n "${ACM_CERT_ARN:-}" ]; then
  echo ""
  echo "--- HTTPS Listener (ACM cert: $ACM_CERT_ARN) ---"

  # Validate the certificate is ISSUED before wiring it to the ALB.
  # A non-ISSUED cert (e.g. PENDING_VALIDATION) cannot serve TLS traffic.
  # If preflight continued it would also convert the HTTP:80 listener to a
  # permanent 301 redirect to HTTPS, making the site completely unreachable
  # until the cert is validated.  Abort early so HTTP keeps working.
  CERT_STATUS=$(aws acm describe-certificate --certificate-arn "$ACM_CERT_ARN" \
    --region $REGION --query 'Certificate.Status' --output text 2>/dev/null || true)
  if [ "$CERT_STATUS" != "ISSUED" ]; then
    echo "ERROR: Certificate status is '$CERT_STATUS' (expected ISSUED)." >&2
    echo "       ACM_CERT_ARN=$ACM_CERT_ARN" >&2
    echo "       The certificate must be fully validated before preflight can" >&2
    echo "       wire it to the ALB.  Proceeding would also convert the HTTP:80" >&2
    echo "       listener to a permanent 301 redirect, making the site completely" >&2
    echo "       unreachable until validation completes.  Complete DNS/email" >&2
    echo "       validation first, then re-run preflight." >&2
    echo "       See docs/self-hosting.md for ACM DNS validation instructions." >&2
    exit 1
  fi

  HTTPS_LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN --region $REGION \
    --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text 2>/dev/null || true)
  if [ "$HTTPS_LISTENER_ARN" = "None" ] || [ -z "$HTTPS_LISTENER_ARN" ]; then
    HTTPS_LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
      --protocol HTTPS --port 443 \
      --certificates "CertificateArn=$ACM_CERT_ARN" \
      --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
      --default-actions "Type=forward,TargetGroupArn=$WEB_TG_ARN" \
      --region $REGION \
      --query 'Listeners[0].ListenerArn' --output text)
    # Guard against a degenerate 'None' return (e.g. mis-scoped --query).
    # Failing here is safer than passing 'None' as a listener ARN to
    # ensure_listener_rule after HTTP:80 has already been converted to a
    # redirect, which would leave the stack in a broken partial state.
    if [ "$HTTPS_LISTENER_ARN" = "None" ] || [ -z "$HTTPS_LISTENER_ARN" ]; then
      echo "ERROR: create-listener returned an invalid ARN ('$HTTPS_LISTENER_ARN')." >&2
      echo "       Aborting before HTTP:80 is modified to avoid a redirect loop." >&2
      exit 1
    fi
    echo "HTTPS listener created: $HTTPS_LISTENER_ARN"
  else
    # Update cert and default action in case either changed.
    aws elbv2 modify-listener --listener-arn "$HTTPS_LISTENER_ARN" \
      --certificates "CertificateArn=$ACM_CERT_ARN" \
      --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
      --default-actions "Type=forward,TargetGroupArn=$WEB_TG_ARN" \
      --region $REGION >/dev/null
    echo "HTTPS listener updated: $HTTPS_LISTENER_ARN"
  fi
fi

# HTTP:80 listener.
# When HTTPS is configured it becomes a redirect; otherwise it carries the
# forward rules as before.
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN --region $REGION \
  --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text 2>/dev/null || true)
if [ -n "${ACM_CERT_ARN:-}" ]; then
  # HTTP → HTTPS redirect (permanent 301).
  HTTP_DEFAULT_ACTION='[{"Type":"redirect","RedirectConfig":{"Protocol":"HTTPS","Port":"443","StatusCode":"HTTP_301"}}]'
  if [ "$LISTENER_ARN" = "None" ] || [ -z "$LISTENER_ARN" ]; then
    LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
      --protocol HTTP --port 80 \
      --default-actions "$HTTP_DEFAULT_ACTION" \
      --region $REGION \
      --query 'Listeners[0].ListenerArn' --output text)
    echo "HTTP redirect listener created: $LISTENER_ARN"
  else
    aws elbv2 modify-listener --listener-arn "$LISTENER_ARN" \
      --default-actions "$HTTP_DEFAULT_ACTION" \
      --region $REGION >/dev/null
    echo "HTTP listener updated to redirect → HTTPS"
    # Remove any existing path-based forward rules from the HTTP listener since
    # all traffic is now unconditionally redirected at the default action level.
    EXISTING_RULES=$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" --region $REGION \
      --query 'Rules[?IsDefault==`false`].RuleArn' --output text 2>/dev/null || true)
    for rule in $EXISTING_RULES; do
      [ -z "$rule" ] && continue
      aws elbv2 delete-rule --rule-arn "$rule" --region $REGION >/dev/null
      echo "Removed forwarding rule from HTTP listener (redirect takes precedence): $rule"
    done
  fi
else
  # Plain HTTP: default action forwards to web, path rules route /api/*.
  if [ "$LISTENER_ARN" = "None" ] || [ -z "$LISTENER_ARN" ]; then
    LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
      --protocol HTTP --port 80 \
      --default-actions "Type=forward,TargetGroupArn=$WEB_TG_ARN" \
      --region $REGION \
      --query 'Listeners[0].ListenerArn' --output text)
  else
    aws elbv2 modify-listener --listener-arn "$LISTENER_ARN" \
      --default-actions "Type=forward,TargetGroupArn=$WEB_TG_ARN" \
      --region $REGION >/dev/null
  fi

  # HTTP-only mode: clean up any orphaned HTTPS:443 listener left over from a
  # previous run that had ACM_CERT_ARN set.  Leaving it in place would mean
  # ALB accepts port-443 connections without a certificate, and a stale
  # ALB_HTTPS_LISTENER_ARN in .env would make the downgrade look incomplete.
  STALE_HTTPS_ARN=$(aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN --region $REGION \
    --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text 2>/dev/null || true)
  if [ -n "$STALE_HTTPS_ARN" ] && [ "$STALE_HTTPS_ARN" != "None" ]; then
    aws elbv2 delete-listener --listener-arn "$STALE_HTTPS_ARN" --region $REGION >/dev/null
    echo "Deleted orphaned HTTPS:443 listener (HTTP-only mode): $STALE_HTTPS_ARN"
  fi
fi

ensure_listener_rule() {
  local listener="$1"
  local priority="$2"
  local tg_arn="$3"
  shift 3
  local existing
  existing=$(aws elbv2 describe-rules --listener-arn "$listener" --region $REGION \
    --query "Rules[?Priority=='$priority'].RuleArn | [0]" --output text 2>/dev/null || true)
  if [ "$existing" = "None" ] || [ -z "$existing" ]; then
    aws elbv2 create-rule --listener-arn "$listener" \
      --priority "$priority" \
      --conditions "$@" \
      --actions "Type=forward,TargetGroupArn=$tg_arn" \
      --region $REGION >/dev/null
  else
    aws elbv2 modify-rule --rule-arn "$existing" \
      --conditions "$@" \
      --actions "Type=forward,TargetGroupArn=$tg_arn" \
      --region $REGION >/dev/null
  fi
}

# Route /api/* to the Go API on whichever listener carries forward rules.
if [ -n "${ACM_CERT_ARN:-}" ] && [ -n "$HTTPS_LISTENER_ARN" ]; then
  ensure_listener_rule "$HTTPS_LISTENER_ARN" 10 "$API_TG_ARN" 'Field=path-pattern,Values=/api/*'
else
  ensure_listener_rule "$LISTENER_ARN" 10 "$API_TG_ARN" 'Field=path-pattern,Values=/api/*'
fi

remove_legacy_auth_rules() {
  local listener
  aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --region "$REGION" \
    --query 'Listeners[].ListenerArn' --output text | tr '\t' '\n' | while read -r listener; do
      [ -z "$listener" ] && continue
      aws elbv2 describe-rules --listener-arn "$listener" --region "$REGION" \
        --query 'Rules[?Conditions[?Field==`path-pattern` && contains(PathPatternConfig.Values, `/auth/*`)]].RuleArn' \
        --output text | tr '\t' '\n' | while read -r rule; do
          [ -z "$rule" ] && continue
          echo "Deleting legacy /auth/* listener rule: $rule" >&2
          aws elbv2 delete-rule --rule-arn "$rule" --region "$REGION" >/dev/null
        done
    done
}

# The Go auth refactor moved all provider endpoints under /api/auth/* and
# left browser-owned auth completion routes, such as /auth/complete, on the
# Next.js web service. Remove stale Kratos-era /auth/* ALB rules so future
# preflight runs cannot keep routing those paths to a retired auth service.
remove_legacy_auth_rules

del_env_file() {
  local key="$1"
  KEY="$key" python3 - <<'PY'
from pathlib import Path
import os

path = Path(os.environ.get("ENV_FILE", ".env"))
key = os.environ["KEY"]
if not path.exists():
    exit(0)
lines = path.read_text().splitlines()
lines = [l for l in lines if not l.startswith(f"{key}=")]
path.write_text("\n".join(lines) + "\n" if lines else "")
PY
}

ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --region $REGION \
  --query 'LoadBalancers[0].DNSName' --output text)
set_env_file ALB_DNS "$ALB_DNS"
set_env_file ALB_ARN "$ALB_ARN"
set_env_file ALB_LISTENER_ARN "$LISTENER_ARN"
set_env_file WEB_TG_ARN "$WEB_TG_ARN"
set_env_file API_TG_ARN "$API_TG_ARN"
if [ -n "${HTTPS_LISTENER_ARN:-}" ]; then
  set_env_file ALB_HTTPS_LISTENER_ARN "$HTTPS_LISTENER_ARN"
else
  # HTTP-only mode: remove any stale ALB_HTTPS_LISTENER_ARN entry so the .env
  # accurately reflects the current stack state after a downgrade run.
  del_env_file ALB_HTTPS_LISTENER_ARN
fi

PRIVATE_DNS_ZONE="${PRIVATE_DNS_ZONE:-${APP_NAME}.internal}"
PRIVATE_DNS_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "${PRIVATE_DNS_ZONE}." \
  --query "HostedZones[?Name=='${PRIVATE_DNS_ZONE}.' && Config.PrivateZone==\`true\`].Id | [0]" \
  --output text 2>/dev/null || true)
if [ "$PRIVATE_DNS_ZONE_ID" = "None" ] || [ -z "$PRIVATE_DNS_ZONE_ID" ]; then
  PRIVATE_DNS_ZONE_ID=$(aws route53 create-hosted-zone \
    --name "$PRIVATE_DNS_ZONE" \
    --vpc "VPCRegion=$REGION,VPCId=$VPC_ID" \
    --caller-reference "${APP_NAME}-private-$(date +%s)" \
    --hosted-zone-config "Comment=Private ECS service names for ${APP_NAME},PrivateZone=true" \
    --query 'HostedZone.Id' --output text)
else
  aws route53 associate-vpc-with-hosted-zone \
    --hosted-zone-id "$PRIVATE_DNS_ZONE_ID" \
    --vpc "VPCRegion=$REGION,VPCId=$VPC_ID" >/dev/null 2>&1 || true
fi
PRIVATE_DNS_ZONE_ID="${PRIVATE_DNS_ZONE_ID##*/}"
set_env_file PRIVATE_DNS_ZONE "$PRIVATE_DNS_ZONE"
set_env_file PRIVATE_DNS_ZONE_ID "$PRIVATE_DNS_ZONE_ID"

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
if [ -n "${ACM_CERT_ARN:-}" ]; then
  echo "TLS: HTTPS:443 listener with ACM cert | HTTP:80 redirects → HTTPS"
  echo "Deploy target: ECS Fargate split services + ALB (HTTPS /api/* → api, default → web; HTTP redirects to HTTPS)"
else
  echo "TLS: none (HTTP only). Set ACM_CERT_ARN in .env to enable HTTPS."
  echo "Deploy target: ECS Fargate split services + ALB (/api/* → api, default → web)"
fi

# Store infrastructure IDs in .env
set_env_file PRIV_SUBNET_A "$PRIV_SUBNET_A"
set_env_file PRIV_SUBNET_B "$PRIV_SUBNET_B"
set_env_file PUB_SUBNET_A "$PUB_SUBNET_A"
set_env_file PUB_SUBNET_B "$PUB_SUBNET_B"
set_env_file APP_SG "$APP_SG"
set_env_file DB_SG "$DB_SG"
set_env_file REDIS_SG "$REDIS_SG"
set_env_file ALB_SG "$ALB_SG"
set_env_file VPC_ID "$VPC_ID"
