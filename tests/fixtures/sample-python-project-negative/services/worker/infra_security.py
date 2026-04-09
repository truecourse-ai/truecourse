"""AWS infrastructure provisioning with security misconfigurations."""
import json
import boto3
from aws_cdk import aws_iam as iam
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_efs as efs
from aws_cdk import aws_rds as rds
from aws_cdk import aws_sqs as sqs
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sagemaker as sagemaker
from aws_cdk import aws_opensearchservice as opensearch
from aws_cdk import aws_apigateway as apigw
from constructs import Construct


class InfraStack:
    """Provisions AWS infrastructure resources."""

    def __init__(self, scope: Construct, id: str):
        self.scope = scope
        self.id = id

    def create_iam_policy(self):
        """Create IAM policy with overly broad permissions."""
        # VIOLATION: security/deterministic/aws-iam-overly-broad-policy
        statement = iam.PolicyStatement(
            actions=["*"],
            resources=["arn:aws:s3:::my-bucket/*"],
        )
        return statement

    def create_iam_all_privileges(self):
        """Create IAM policy granting all privileges."""
        # VIOLATION: security/deterministic/aws-iam-all-privileges-python
        admin_policy = iam.PolicyStatement(
            actions=["*"],
            resources=["arn:aws:s3:::admin-bucket/*"],
        )
        return admin_policy

    def create_iam_all_resources(self):
        """Create IAM policy granting access to all resources."""
        # VIOLATION: security/deterministic/aws-iam-all-resources-python
        statement = iam.PolicyStatement(
            actions=["s3:GetObject", "s3:PutObject"],
            resources=["*"],
        )
        return statement

    def create_public_api(self):
        """Create API Gateway without authorization."""
        # VIOLATION: security/deterministic/aws-public-api-python
        api = apigw.RestApi(
            self.scope,
            "PublicApi",
            default_method_options={"authorization_type": "NONE"},
        )
        return api

    def create_s3_bucket(self):
        """Create S3 bucket with versioning suspended."""
        # VIOLATION: security/deterministic/aws-s3-no-versioning-python
        bucket = s3.CfnBucket(
            self.scope,
            "DataBucket",
            versioning_configuration={"status": "suspended"},
        )
        return bucket

    def create_ebs_volume(self):
        """Create unencrypted EBS volume."""
        # VIOLATION: security/deterministic/aws-unencrypted-ebs-python
        volume = ec2.Volume(
            self.scope,
            "DataVolume",
            availability_zone="us-east-1a",
            size=100,
            encrypted=False,
        )
        return volume

    def create_efs_filesystem(self):
        """Create unencrypted EFS file system."""
        # VIOLATION: security/deterministic/aws-unencrypted-efs-python
        fs = efs.FileSystem(
            self.scope,
            "SharedFS",
            vpc=None,
        )
        return fs

    def create_opensearch_domain(self):
        """Create OpenSearch domain without encryption."""
        # VIOLATION: security/deterministic/aws-unencrypted-opensearch-python
        domain = opensearch.Domain(
            self.scope,
            "SearchDomain",
            version="OpenSearch_2.5",
            encryption_at_rest={"enabled": False},
        )
        return domain

    def create_rds_instance(self):
        """Create RDS instance without storage encryption."""
        # VIOLATION: security/deterministic/aws-unencrypted-rds-python
        db = rds.DatabaseInstance(
            self.scope,
            "AppDB",
            engine=rds.DatabaseInstanceEngine.POSTGRES,
            storage_encrypted=False,
        )
        return db

    def create_sagemaker_notebook(self):
        """Create SageMaker notebook without KMS encryption."""
        # VIOLATION: security/deterministic/aws-unencrypted-sagemaker-python
        notebook = sagemaker.CfnNotebookInstance(
            self.scope,
            "MLNotebook",
            instance_type="ml.t3.medium",
        )
        return notebook

    def create_sns_topic(self):
        """Create SNS topic without encryption."""
        # VIOLATION: security/deterministic/aws-unencrypted-sns-python
        topic = sns.Topic(
            self.scope,
            "AlertsTopic",
            display_name="Service Alerts",
        )
        return topic

    def create_sqs_queue(self):
        """Create SQS queue without encryption."""
        # VIOLATION: security/deterministic/aws-unencrypted-sqs-python
        queue = sqs.Queue(
            self.scope,
            "TaskQueue",
            visibility_timeout=300,
        )
        return queue

    def create_security_group(self):
        """Create security group with unrestricted SSH access."""
        sg = ec2.SecurityGroup(self.scope, "WebSG", vpc=None)

        # VIOLATION: security/deterministic/aws-unrestricted-admin-access
        sg.add_ingress_rule(
            peer=ec2.Peer.any_ipv4(),
            connection=ec2.Port.tcp(22),
            description="SSH from anywhere 0.0.0.0/0",
        )
        return sg

    def create_egress_rule(self):
        """Create security group with unrestricted outbound."""
        sg = ec2.SecurityGroup(self.scope, "AppSG", vpc=None)

        # VIOLATION: security/deterministic/aws-unrestricted-outbound
        sg.add_egress_rule(
            peer=ec2.Peer.any_ipv4(),
            connection=ec2.Port.ALL_TRAFFIC,
            description="Allow all outbound 0.0.0.0/0",
        )
        return sg

    def create_public_policy_string(self):
        """Create a policy document with wildcard principal."""
        # VIOLATION: security/deterministic/aws-public-policy
        policy_doc = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::public-bucket/*"}]}'
        return json.loads(policy_doc)

    def create_s3_client_insecure(self):
        """Create S3 client without SSL."""
        # VIOLATION: security/deterministic/s3-insecure-http
        client = boto3.client("s3", use_ssl=False)
        return client

    def create_public_rds_instance(self):
        """Create publicly accessible RDS instance."""
        # VIOLATION: security/deterministic/aws-public-resource-python
        db = rds.CfnDBInstance(
            self.scope,
            "PublicDB",
            engine="postgres",
            publicly_accessible=True,
        )
        return db

    def get_bucket_policy_unrestricted(self):
        """Return an S3 bucket policy with wildcard principal."""
        # VIOLATION: security/deterministic/s3-unrestricted-access
        policy = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:*","Resource":"arn:aws:s3:::data-bucket/*"}]}'
        return json.loads(policy)
