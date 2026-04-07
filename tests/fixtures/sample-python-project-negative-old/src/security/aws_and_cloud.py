"""Security violations: AWS CDK, S3, IAM, and cloud infrastructure."""
from aws_cdk import aws_iam as iam
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_rds as rds
from aws_cdk import aws_opensearchservice as opensearch
from aws_cdk import aws_sagemaker as sagemaker
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sqs as sqs
from aws_cdk import aws_efs as efs
from aws_cdk import aws_apigateway as apigateway
import boto3


# VIOLATION: security/deterministic/aws-iam-overly-broad-policy
policy = iam.PolicyStatement(
    actions=["s3:*"],
    resources=["*"],
)


# VIOLATION: security/deterministic/aws-iam-all-privileges-python
admin_policy = iam.PolicyStatement(
    actions=["*"],
    resources=["*"],
)


# VIOLATION: security/deterministic/aws-iam-all-resources-python
resource_policy = iam.PolicyStatement(
    actions=["s3:GetObject"],
    resources=["*"],
)


# VIOLATION: security/deterministic/aws-unrestricted-admin-access
sg.add_ingress_rule(
    peer=ec2.Peer.any_ipv4(),
    connection=ec2.Port.tcp(22),
    description="SSH from anywhere"
)


# VIOLATION: security/deterministic/aws-public-policy
bucket_policy_doc = '{"Statement": [{"Effect": "Allow", "Principal": "*", "Action": "s3:GetObject"}]}'


# VIOLATION: security/deterministic/aws-public-resource-python
public_db = DatabaseInstance(
    self, "PublicDB",
    engine="postgres",
    publicly_accessible=True,
)


# VIOLATION: security/deterministic/aws-unrestricted-outbound
sg.add_egress_rule(
    peer=ec2.Peer.any_ipv4(),
    connection=ec2.Port.ALL_TRAFFIC,
    description="Allow all outbound"
)


# VIOLATION: security/deterministic/aws-unencrypted-ebs-python
volume = ec2.Volume(
    self, "Vol",
    availability_zone="us-east-1a",
    size=100,
    encrypted=False,
)


# VIOLATION: security/deterministic/aws-unencrypted-rds-python
db = rds.DatabaseInstance(
    self, "DB",
    engine=rds.DatabaseInstanceEngine.POSTGRES,
    storage_encrypted=False,
)


# VIOLATION: security/deterministic/aws-unencrypted-opensearch-python
domain = opensearch.Domain(
    self, "Domain",
    encryption_at_rest=opensearch.EncryptionAtRestOptions(enabled=False),
)


# VIOLATION: security/deterministic/aws-unencrypted-sagemaker-python
notebook = sagemaker.CfnNotebookInstance(
    self, "Notebook",
    instance_type="ml.t3.medium",
)


# VIOLATION: security/deterministic/aws-unencrypted-sns-python
topic = sns.Topic(
    self, "Topic",
)


# VIOLATION: security/deterministic/aws-unencrypted-sqs-python
queue = sqs.Queue(
    self, "Queue",
)


# VIOLATION: security/deterministic/aws-unencrypted-efs-python
filesystem = efs.FileSystem(
    self, "EFS",
    vpc=vpc,
    encrypted=False,
)


# VIOLATION: security/deterministic/aws-public-api-python
api = RestApi(
    self, "API",
    default_method_options={"authorization_type": "NONE"},
)


# VIOLATION: security/deterministic/aws-s3-no-versioning-python
unversioned = s3.Bucket(
    self, "Unversioned",
    versioning_configuration={"status": "suspended"},
)


# VIOLATION: security/deterministic/s3-insecure-http
s3_client = boto3.client("s3", endpoint_url="http://s3.amazonaws.com")


# VIOLATION: security/deterministic/s3-unrestricted-access
s3_policy = '{"Statement": [{"Effect": "Allow", "Principal": "*", "Action": "s3:*"}]}'
