import { addResource } from "./utils";

class EventBridgeSqsPlugin {
  serverless: any;
  options: any;
  hooks: any;
  commands: Serverless.CommandsDefinition;
  stage: string;

  constructor(serverless: any, options: Serverless.Options) {
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
          pattern: { type: "object" }
        },
        required: ["eventBus"],
        additionalProperties: false
      }
    );

    this.hooks = {
      "aws:package:finalize:mergeCustomProviderResources":
        this.modifyTemplate.bind(this)
    };
  }

  /**
   * Mutate the CloudFormation template, adding the necessary resources for
   * the Lambda to subscribe to Eventbridge
   */
  modifyTemplate() {
    const functions = this.serverless.service.functions;
    const template =
      this.serverless.service.provider.compiledCloudFormationTemplate;

    Object.keys(functions).forEach(functionName => {
      const func = functions[functionName];
      (func.events ?? []).forEach((event: any, i: number) => {
        if (!event.eventBridgeSqs) return;
        this.addResources(
          template,
          functionName,
          this.stage,
          event.eventBridgeSqs,
          i
        );
      });
    });

    console.log(template);
  }

  addResources(
    template: any,
    functionName: string,
    stage: string,
    eventBridgeSqsConfig: any,
    i: number
  ): void {
    [
      this.addQueue,
      this.addEventRule,
      this.addQueuePolicy,
      this.addEventSourceMapping,
      this.addLambdaSqsPermissions
    ].reduce((template, func) => {
      func(template, functionName, eventBridgeSqsConfig, i);
      return template;
    }, template);
  }

  addQueue(template: any, functionName, config: any, i): void {
    addResource(template, `${functionName}${i}Queue`, {
      Type: "AWS::SQS::Queue"
    });
  }

  addEventRule(template: any, functionName, config: any, i): void {
    const ruleName = `${functionName}${i}EventRule`;
    const queueName = `${functionName}${i}Queue`;
    addResource(template, ruleName, {
      Type: "AWS::Events::Rule",
      Properties: {
        EventBusName: config.eventBus,
        EventPattern: config.pattern,
        Targets: [
          {
            Arn: { "Fn::GetAtt": [queueName, "Arn"] },
            Id: `${ruleName}-target`
          }
        ]
      }
    });
  }

  addQueuePolicy(template: any, functionName, config: any, i): void {
    const queueName = `${functionName}${i}Queue`;
    addResource(template, `${functionName}${i}QueuePolicy`, {
      Type: "AWS::SQS::QueuePolicy",
      Properties: {
        PolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "events.amazonaws.com"
              },
              Action: "SQS:SendMessage",
              Resource: {
                "Fn::GetAtt": [queueName, "Arn"]
              }
            }
          ]
        },
        Queues: [
          {
            Ref: queueName
          }
        ]
      }
    });
  }

  addEventSourceMapping(template: any, functionName, config: any, i): void {
    const queueName = `${functionName}${i}Queue`;
    addResource(template, `${functionName}${i}EventSourceMapping`, {
      Type: "AWS::Lambda::EventSourceMapping",
      Properties: {
        EventSourceArn: { "Fn::GetAtt": [queueName, "Arn"] },
        FunctionName: {
          "Fn::GetAtt": [`${functionName}LambdaFunction`, "Arn"]
        },
        Enabled: "True"
      }
    });
  }

  /**
   * Add permissions so that the SQS handler can access the queue.
   */
  addLambdaSqsPermissions(template: any, functionName, config: any, i): void {
    if (template.Resources.IamRoleLambdaExecution === undefined) return;

    const queueName = `${functionName}${i}Queue`;

    template.Resources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument.Statement.push(
      {
        Effect: "Allow",
        Action: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ],
        Resource: [{ "Fn::GetAtt": [queueName, "Arn"] }]
      }
    );
  }
}

export default EventBridgeSqsPlugin;
