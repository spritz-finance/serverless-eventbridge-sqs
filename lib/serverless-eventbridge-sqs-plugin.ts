import { addResource } from "./utils";

type Serverless = any;
type Options = any;

type EventConfig = {
  eventBus?: string;
  pattern?: any;
  inputTransformer?: any;
  visibilityTimeout?: number;
  batchSize?: number;
  messageRetentionPeriod?: number;
  delaySeconds?: number;
  redrivePolicy?: any;
  encryption?: any;
};

type ResourcesArg = {
  template: any;
  functionName: string;
  stage: string;
  eventConfig: EventConfig;
  index: number;
};

function getLambda(args: ResourcesArg) {
  return `${args.functionName}LambdaFunction`;
}

function getResourceName(args: ResourcesArg, suffix: string) {
  const idx = args.index === 0 ? "" : args.index + 1;
  return `${args.functionName}EBSQS${idx}${suffix}`;
}

function getQueueName(args: ResourcesArg) {
  return getResourceName(args, "Queue");
}

const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_EVENT_PATTERN = {
  source: [
    {
      prefix: "",
    },
  ],
};

class ServerlessEventBridgeSqsPlugin {
  serverless: Serverless;
  options: Options;
  hooks: any;
  stage: string;

  constructor(serverless: Serverless, options: Options) {
    this.serverless = serverless;
    this.options = options;
    this.stage =
      this.options.stage ??
      this.serverless.config.stage ??
      this.serverless.service.provider.stage;

    serverless.configSchemaHandler.defineFunctionEvent(
      "aws",
      "eventBridgeSqs",
      {
        type: "object",
        properties: {
          eventBus: { type: "string" },
          pattern: { type: "object" },
          visibilityTimeout: { type: "number" },
          batchSize: { type: "number" },
          inputTransformer: { type: "object" },
          messageRetentionPeriod: { type: "number" },
          delaySeconds: { type: "number" },
          redrivePolicy: { type: "object" },
          encryption: { type: "object" },
        },
        required: [],
        additionalProperties: false,
      }
    );

    this.hooks = {
      "aws:package:finalize:mergeCustomProviderResources":
        this.modifyTemplate.bind(this),
    };
  }

  /**
   * Mutate the CloudFormation template, adding the necessary resources for
   * the Lambda to subscribe to Eventbridge
   */
  modifyTemplate(): void {
    const functions = this.serverless.service.functions;
    const template =
      this.serverless.service.provider.compiledCloudFormationTemplate;

    Object.keys(functions).forEach((functionName) => {
      const func = functions[functionName];
      (func.events ?? []).forEach((event: any, index: number) => {
        if (!event.eventBridgeSqs) return;
        this.addResources({
          template,
          functionName,
          stage: this.stage,
          eventConfig: event.eventBridgeSqs,
          index,
        });
      });
    });
  }

  addResources(args: ResourcesArg): void {
    if (this.options.verbose) {
      console.info(
        `Adding eventBridgeSqs event handler [${args.functionName} #${args.index}]`
      );
    }

    [
      this.addQueue,
      this.addEventRule,
      this.addQueuePolicy,
      this.addEventSourceMapping,
      this.addLambdaSqsPermissions,
    ].reduce((template, func) => {
      func(args);
      return template;
    }, args.template);
  }

  /**
   * Add the queue
   */
  addQueue(args: ResourcesArg): void {
    addResource(args.template, getQueueName(args), {
      Type: "AWS::SQS::Queue",
      Properties: {
        ...(args.eventConfig.visibilityTimeout !== undefined
          ? {
              VisibilityTimeout: args.eventConfig.visibilityTimeout,
            }
          : {}),
        ...(args.eventConfig.messageRetentionPeriod !== undefined
          ? {
              MessageRetentionPeriod: args.eventConfig.messageRetentionPeriod,
            }
          : {}),
        ...(args.eventConfig.delaySeconds !== undefined
          ? {
              DelaySeconds: args.eventConfig.delaySeconds,
            }
          : {}),
        ...(args.eventConfig.redrivePolicy !== undefined
          ? {
              RedrivePolicy: args.eventConfig.redrivePolicy,
            }
          : {}),
        ...(args.eventConfig.encryption !== undefined
          ? {
              KmsMasterKeyId: args.eventConfig.encryption.kmsMasterKeyId,
              KmsDataKeyReusePeriodSeconds:
                args.eventConfig.encryption.kmsDataKeyReusePeriodSeconds,
            }
          : {}),
      },
    });
  }

  /**
   * Add an event rule from eventbridge to lambda
   */
  addEventRule(args: ResourcesArg): void {
    const ruleName = getResourceName(args, "EventRule");
    const queueName = getQueueName(args);
    const ruleProperties: any = {
      Type: "AWS::Events::Rule",
      Properties: {
        EventPattern: args.eventConfig.pattern ?? DEFAULT_EVENT_PATTERN,
        ...(args.eventConfig.eventBus !== undefined
          ? {
              EventBusName: args.eventConfig.eventBus,
            }
          : {}),
        Targets: [
          {
            Arn: { "Fn::GetAtt": [queueName, "Arn"] },
            Id: `${ruleName}Target`,
            ...(args.eventConfig.inputTransformer !== undefined
              ? {
                  InputTransformer: args.eventConfig.inputTransformer,
                }
              : {}),
          },
        ],
      },
    };

    addResource(args.template, getResourceName(args, "EventRule"), {
      Type: "AWS::Events::Rule",
      Properties: ruleProperties,
    });
  }

  /**
   * Add permission for eventbridge to sendMessage to the queue
   */
  addQueuePolicy(args: ResourcesArg): void {
    const queueName = getQueueName(args);
    addResource(args.template, getResourceName(args, "QueuePolicy"), {
      Type: "AWS::SQS::QueuePolicy",
      Properties: {
        PolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "events.amazonaws.com",
              },
              Action: "SQS:SendMessage",
              Resource: {
                "Fn::GetAtt": [queueName, "Arn"],
              },
            },
          ],
        },
        Queues: [
          {
            Ref: queueName,
          },
        ],
      },
    });
  }

  /**
   * Add SQS as an event source for the lambda
   */
  addEventSourceMapping(args: ResourcesArg): void {
    const queueName = getQueueName(args);
    addResource(args.template, getResourceName(args, "EventSourceMapping"), {
      Type: "AWS::Lambda::EventSourceMapping",
      Properties: {
        BatchSize: args.eventConfig.batchSize ?? DEFAULT_BATCH_SIZE,
        EventSourceArn: { "Fn::GetAtt": [queueName, "Arn"] },
        FunctionName: {
          "Fn::GetAtt": [getLambda(args), "Arn"],
        },
        Enabled: "True",
      },
    });
  }

  /**
   * Add permissions so that the SQS handler can access the queue.
   */
  addLambdaSqsPermissions(args: ResourcesArg): void {
    if (args.template.Resources.IamRoleLambdaExecution === undefined) return;

    const queueName = getQueueName(args);

    args.template.Resources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument.Statement.push(
      {
        Effect: "Allow",
        Action: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ],
        Resource: [{ "Fn::GetAtt": [queueName, "Arn"] }],
      }
    );
  }
}

export default ServerlessEventBridgeSqsPlugin;
