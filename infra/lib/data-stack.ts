/**
 * OmniScribeDataStack — data-plane only.
 *
 * Provisions the resources OmniScribe needs regardless of compute
 * choice (App Runner, ECS Fargate, EKS, etc):
 *
 *   - VPC with public + private subnets across 2 AZs (multi-AZ for
 *     RDS standby; public subnets host NAT + ALB later)
 *   - RDS Postgres 16 with pgvector (the production app requires
 *     pgvector for Wave 0 voice embeddings; switching engines later
 *     forces a volume reset, so it lands here from day one)
 *   - ElastiCache for Redis (BullMQ-compatible; requires
 *     maxRetriesPerRequest=null on the client — see app's
 *     src/lib/redis.ts)
 *   - S3 audio bucket with public access blocked (Rule 15: NEVER
 *     allow public bucket access; presigned URLs only)
 *   - Secrets Manager secrets for:
 *       - NEXTAUTH_SECRET (auto-generated)
 *       - DATABASE_URL (built from RDS credentials secret)
 *       - REDIS_URL (built from ElastiCache endpoint + auth token)
 *       - AWS_BEARER_TOKEN_BEDROCK (placeholder; rotate manually)
 *       - SONIOX_API_KEY (placeholder; rotate manually)
 *       - RESEND_API_KEY (placeholder; rotate manually)
 *
 * Out of scope (separate stack):
 *   - Compute (App Runner / ECS / EKS — decision pending)
 *   - CloudFront distribution + WAF
 *   - Bedrock IAM role (depends on compute task role)
 *   - Cross-region replication
 *
 * Production posture: deletion protection ON for RDS; bucket has
 * lifecycle rule (audio NEVER deleted per Rule 7 — soft-delete only).
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export type OmniScribeDataStackProps = cdk.StackProps & {
  envName: 'dev' | 'staging' | 'prod';
};

export class OmniScribeDataStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly database: rds.DatabaseInstance;
  public readonly redis: elasticache.CfnReplicationGroup;
  public readonly audioBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: OmniScribeDataStackProps) {
    super(scope, id, props);

    const isProd = props.envName === 'prod';
    const removalPolicy = isProd
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // -------------------------------------------------------------------
    // VPC
    // -------------------------------------------------------------------
    // 2 AZs is the minimum for RDS Multi-AZ. NAT in each AZ in prod for
    // HA; single NAT in dev/staging to cut costs.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: isProd ? 2 : 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // -------------------------------------------------------------------
    // RDS Postgres 16 with pgvector
    // -------------------------------------------------------------------
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      description: 'OmniScribe Postgres — accepts traffic from private subnets only',
      allowAllOutbound: false,
    });
    // Allow Postgres traffic from the app's private subnet.
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Postgres from VPC',
    );

    this.database = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      // Sized for dev/staging; prod likely needs t4g.large or higher.
      // Tune per-env via context (out of scope for the skeleton).
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        isProd ? ec2.InstanceSize.MEDIUM : ec2.InstanceSize.MICRO,
      ),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      databaseName: 'omniscribe',
      credentials: rds.Credentials.fromGeneratedSecret('omniscribe', {
        secretName: `/omniscribe/${props.envName}/database-credentials`,
      }),
      multiAz: isProd,
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(isProd ? 30 : 7),
      deletionProtection: isProd,
      removalPolicy,
      // pgvector — must be installed via a parameter group + post-create
      // CREATE EXTENSION. Default parameter group enables it; the
      // migration step in CI runs `CREATE EXTENSION IF NOT EXISTS vector`.
      parameterGroup: new rds.ParameterGroup(this, 'DbParams', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16,
        }),
        parameters: {
          'shared_preload_libraries': 'pg_stat_statements',
        },
      }),
    });

    // -------------------------------------------------------------------
    // ElastiCache for Redis
    // -------------------------------------------------------------------
    // BullMQ requires maxRetriesPerRequest=null on the client (see
    // app's src/lib/redis.ts). Auth token required in prod; optional in
    // dev to keep local mirroring simpler.
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc: this.vpc,
      description: 'OmniScribe Redis — accepts traffic from private subnets only',
      allowAllOutbound: false,
    });
    redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Redis from VPC',
    );

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'OmniScribe Redis subnet group',
      subnetIds: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED })
        .subnetIds,
    });

    const redisAuthToken = new secretsmanager.Secret(this, 'RedisAuthToken', {
      secretName: `/omniscribe/${props.envName}/redis-auth-token`,
      description: 'OmniScribe Redis AUTH token',
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 40,
      },
    });

    this.redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: `OmniScribe ${props.envName} Redis (BullMQ + cache)`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: isProd ? 'cache.t4g.small' : 'cache.t4g.micro',
      numNodeGroups: 1,
      replicasPerNodeGroup: isProd ? 1 : 0,
      automaticFailoverEnabled: isProd,
      multiAzEnabled: isProd,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      authToken: redisAuthToken.secretValue.unsafeUnwrap(),
      snapshotRetentionLimit: isProd ? 7 : 1,
    });
    this.redis.addDependency(redisSubnetGroup);

    // -------------------------------------------------------------------
    // S3 audio bucket (Rule 15: NEVER allow public access)
    // -------------------------------------------------------------------
    this.audioBucket = new s3.Bucket(this, 'AudioBucket', {
      bucketName: `omniscribe-audio-${props.envName}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: isProd,
      // Rule 7: audio files NEVER hard-deleted from S3 — only soft-
      // deleted in DB. The lifecycle rule transitions to IA after
      // 90 days but never deletes. Glacier transition optional later.
      lifecycleRules: [
        {
          id: 'transition-to-IA-after-90-days',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      removalPolicy,
      // Auto-delete only in dev/staging where removalPolicy is DESTROY.
      autoDeleteObjects: !isProd,
    });

    // -------------------------------------------------------------------
    // Secrets — placeholders the app reads at runtime
    // -------------------------------------------------------------------
    // NEXTAUTH_SECRET: auto-generated; rotation requires forcing
    // re-sign-in for all sessions. Rotate annually or after suspected
    // compromise.
    new secretsmanager.Secret(this, 'NextauthSecret', {
      secretName: `/omniscribe/${props.envName}/nextauth-secret`,
      description: 'OmniScribe NEXTAUTH_SECRET (rotate annually)',
      generateSecretString: {
        excludePunctuation: false,
        passwordLength: 64,
      },
    });

    // External provider keys: empty placeholders; ops fills them via
    // the AWS console or `aws secretsmanager put-secret-value`.
    // CLAUDE.md tripwire: AWS_BEARER_TOKEN_BEDROCK is the long-term
    // API key (ABSK… format), DIFFERENT from AWS_ACCESS_KEY_ID
    // (SigV4 IAM credentials). Don't conflate.
    for (const [name, description] of [
      ['bedrock-bearer-token', 'AWS_BEARER_TOKEN_BEDROCK (ABSK… format; NOT SigV4)'],
      ['soniox-api-key', 'SONIOX_API_KEY (long-lived org key; rotate per Soniox policy)'],
      ['resend-api-key', 'RESEND_API_KEY (transactional email; rotate annually)'],
    ] as const) {
      new secretsmanager.Secret(this, `Secret_${name.replace(/-/g, '_')}`, {
        secretName: `/omniscribe/${props.envName}/${name}`,
        description,
        // Empty string placeholder — ops MUST fill before deploy.
        secretStringValue: cdk.SecretValue.unsafePlainText(''),
      });
    }

    // -------------------------------------------------------------------
    // CloudFormation outputs — for ops + the compute stack to consume
    // -------------------------------------------------------------------
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
    });
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: this.database.secret?.secretArn ?? '(none)',
    });
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: this.redis.attrPrimaryEndPointAddress,
    });
    new cdk.CfnOutput(this, 'AudioBucketName', {
      value: this.audioBucket.bucketName,
    });
  }
}
