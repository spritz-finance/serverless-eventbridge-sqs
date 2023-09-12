import {
  addResource,
  isKmsArn,
  parseIntOr,
  pascalCase,
  pascalCaseAllKeys,
  validateQueueName
} from "./utils";



export default class EventBridgeSqsPlugin {
  serverless: any;
  options: any;
  provider: any;
  custom: any;
  serviceName: string;
  stage: string;
  hooks: any;

  /**
   * @param {*} serverless
   * @param {*} options
   */
  constructor(serverless: any, options: any) {
    this.serverless = serverless;
    this.options = options;
    this.provider = serverless ? serverless.getProvider("aws") : null;
    this.custom = serverless.service ? serverless.service.custom : null;
    this.serviceName = serverless.service.service;

    // Aligns with AWS provider order of precedence: https://github.com/serverless/serverless/blob/46d090a302b9f7f4a3cf479695489b7ffc46b75b/lib/plugins/aws/provider.js#L1728
    // Serverless will set one of these to "dev" if it is not provided so we don't need an explicit fallback
    this.stage =
      this.options.stage ||
      this.serverless.config.stage ||
      this.serverless.service.provider.stage;

    serverless.configSchemaHandler.defineFunctionEvent(
      "aws",
      "eventBridgeSqs",
      {
        type: "object",
        properties: {
          name: { type: "string" },
          eventBusArn: { $ref: "#/definitions/awsArn" },
          prefix: { type: "string" },
          omitPhysicalId: { type: "boolean" },
          batchSize: { type: "number", minimum: 1, maximum: 10000 },
          maximumBatchingWindowInSeconds: {
            type: "number",
            minimum: 0,
            maximum: 300
          },
          maxRetryCount: { type: "number" },
          kmsMasterKeyId: {
            anyOf: [{ type: "string" }, { $ref: "#/definitions/awsArn" }]
          },
          kmsDataKeyReusePeriodSeconds: {
            type: "number",
            minimum: 60,
            maximum: 86400
          },
          visibilityTimeout: {
            type: "number",
            minimum: 0,
            maximum: 43200
          },
          deadLetterMessageRetentionPeriodSeconds: {
            type: "number",
            minimum: 60,
            maximum: 1209600
          },
          rawMessageDelivery: { type: "boolean" },
          enabled: { type: "boolean" },
          fifo: { type: "boolean" },
          pattern: { type: "object" },
          mainQueueOverride: { type: "object" },
          deadLetterQueueOverride: { type: "object" },
          eventSourceMappingOverride: { type: "object" },
          subscriptionOverride: { type: "object" }
        },
        required: ["name", "eventBusArn"],
        additionalProperties: false
      }
    );

    if (!this.provider) {
      throw new Error("This plugin must be used with AWS");
    }

    this.hooks = {
      "aws:package:finalize:mergeCustomProviderResources":
        this.modifyTemplate.bind(this)
    };
  }

  /**
   * Mutate the CloudFormation template, adding the necessary resources for
   * the Lambda to subscribe to the SNS topics with error handling and retry
   * functionality built in.
   */
  modifyTemplate() {
    const functions = this.serverless.service.functions;
    const template =
      this.serverless.service.provider.compiledCloudFormationTemplate;

    Object.keys(functions).forEach(funcKey => {
      const func = functions[funcKey];
      if (func.events) {
        func.events.forEach(event => {
          if (event.eventBridgeSqs) {
            if (this.options.verbose) {
              console.info(
                `Adding eventBridgeSqs event handler [${JSON.stringify(
                  event.eventBridgeSqs
                )}]`
              );
            }
            this.addEventBridgeSqsResources(
              template,
              funcKey,
              this.stage,
              event.eventBridgeSqs
            );
          }
        });
      }
    });
  }

  /**
   *
   * @param {object} template the template which gets mutated
   * @param {string} funcName the name of the function from serverless config
   * @param {string} stage the stage name from the serverless config
   * @param {object} eventBridgeSqsConfig the configuration values from the eventBridgeSqs
   *  event portion of the serverless function config
   */
  addEventBridgeSqsResources(template, funcName, stage, eventBridgeSqsConfig) {
    const config = this.validateConfig(funcName, stage, eventBridgeSqsConfig);

    [
      this.addEventSourceMapping,
      this.addEventDeadLetterQueue,
      this.addEventQueue,
      this.addEventQueuePolicy,
      this.addTopicSubscription,
      this.addLambdaSqsPermissions
    ].reduce((template, func) => {
      func(template, config);
      return template;
    }, template);
  }

  /**
   * Validate the configuration values from the serverless config file,
   * returning a config object that can be passed to the resource setup
   * functions.
   *
   * @param {string} funcName the name of the function from serverless config
   * @param {string} stage the stage name from the serverless config
   * @param {object} config the configuration values from the eventBridgeSqs event
   *  portion of the serverless function config
   */
  validateConfig(funcName, stage, config): Config {
    if (!config.eventBusArn || !config.name) {
      throw new Error(`Error:
When creating an eventBridgeSqs handler, you must define the name and eventBusArn.
In function [${funcName}]:
- name was [${config.name}]
- eventBusArn was [${config.eventBusArn}].

Usage
-----

  functions:
    processEvent:
      handler: handler.handler
      events:
        - eventBridgeSqs:
            name: Event                                      # required
            eventBusArn: !Ref eventBusArn                          # required
            prefix: some-prefix                              # optional - default is \`\${this.serviceName}-\${stage}-\${funcNamePascalCase}\`
            maxRetryCount: 2                                 # optional - default is 5
            batchSize: 1                                     # optional - default is 10
            batchWindow: 10                                  # optional - default is 0 (no batch window)
            kmsMasterKeyId: alias/aws/sqs                    # optional - default is none (no encryption)
            kmsDataKeyReusePeriodSeconds: 600                # optional - AWS default is 300 seconds
            deadLetterMessageRetentionPeriodSeconds: 1209600 # optional - AWS default is 345600 secs (4 days)
            enabled: true                                    # optional - AWS default is true
            fifo: false                                      # optional - AWS default is false
            visibilityTimeout: 30                            # optional - AWS default is 30 seconds
            rawMessageDelivery: false                        # optional - default is false
            pattern:
              pet:
                - dog
                - cat

            # Overrides for generated CloudFormation templates
            # Mirrors the CloudFormation docs but uses camel case instead of title case
            #
            #
            # https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-sqs-queues.html
            mainQueueOverride:
              maximumMessageSize: 1024
              ...
            deadLetterQueueOverride:
              maximumMessageSize: 1024
              ...
            # https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-eventsourcemapping.html
            eventSourceMappingOverride:
              bisectBatchOnFunctionError: true
            # https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-sns-subscription.html
            subscriptionOverride:
              rawMessageDelivery: true

`);
    }

    const funcNamePascalCase = pascalCase(funcName);
    return {
      ...config,
      name: config.name,
      funcName: funcNamePascalCase,
      prefix:
        config.prefix || `${this.serviceName}-${stage}-${funcNamePascalCase}`,
      batchSize: parseIntOr(config.batchSize, 10),
      maxRetryCount: parseIntOr(config.maxRetryCount, 5),
      kmsMasterKeyId: config.kmsMasterKeyId,
      kmsDataKeyReusePeriodSeconds: config.kmsDataKeyReusePeriodSeconds,
      deadLetterMessageRetentionPeriodSeconds:
        config.deadLetterMessageRetentionPeriodSeconds,
      enabled: config.enabled,
      fifo: config.fifo !== undefined ? config.fifo : false,
      visibilityTimeout: config.visibilityTimeout,
      rawMessageDelivery:
        config.rawMessageDelivery !== undefined
          ? config.rawMessageDelivery
          : false,
      mainQueueOverride: config.mainQueueOverride ?? {},
      deadLetterQueueOverride: config.deadLetterQueueOverride ?? {},
      eventSourceMappingOverride: config.eventSourceMappingOverride ?? {},
      subscriptionOverride: config.subscriptionOverride ?? {}
    };
  }

  /**
   * Add the Event Source Mapping which sets up the message handler to pull
   * events of the Event Queue and handle them.
   *
   * @param {object} template the template which gets mutated
   * @param {{funcName, name, prefix, batchSize, enabled}} config including name of the queue
   *  and the resource prefix
   */
  addEventSourceMapping(
    template,
    {
      funcName,
      name,
      batchSize,
      maximumBatchingWindowInSeconds,
      enabled,
      eventSourceMappingOverride
    }: Config
  ) {
    const enabledWithDefault = enabled !== undefined ? enabled : true;
    addResource(template, `${funcName}EventSourceMappingSQS${name}Queue`, {
      Type: "AWS::Lambda::EventSourceMapping",
      Properties: {
        BatchSize: batchSize,
        MaximumBatchingWindowInSeconds:
          maximumBatchingWindowInSeconds !== undefined
            ? maximumBatchingWindowInSeconds
            : 0,
        EventSourceArn: { "Fn::GetAtt": [`${name}Queue`, "Arn"] },
        FunctionName: { "Fn::GetAtt": [`${funcName}LambdaFunction`, "Arn"] },
        Enabled: enabledWithDefault ? "True" : "False",
        ...pascalCaseAllKeys(eventSourceMappingOverride)
      }
    });
  }

  /**
   * Add the Dead Letter Queue which will collect failed messages for later
   * inspection and handling.
   *
   * @param {object} template the template which gets mutated
   * @param {{name, prefix, kmsMasterKeyId, kmsDataKeyReusePeriodSeconds, deadLetterMessageRetentionPeriodSeconds }} config including name of the queue
   *  and the resource prefix
   */
  addEventDeadLetterQueue(
    template,
    {
      name,
      prefix,
      fifo,
      kmsMasterKeyId,
      kmsDataKeyReusePeriodSeconds,
      deadLetterMessageRetentionPeriodSeconds,
      deadLetterQueueOverride,
      omitPhysicalId
    }
  ) {
    const candidateQueueName = `${prefix}${name}DeadLetterQueue${
      fifo ? ".fifo" : ""
    }`;
    addResource(template, `${name}DeadLetterQueue`, {
      Type: "AWS::SQS::Queue",
      Properties: {
        ...(omitPhysicalId
          ? {}
          : { QueueName: validateQueueName(candidateQueueName) }),
        ...(fifo ? { FifoQueue: true } : {}),
        ...(kmsMasterKeyId !== undefined
          ? {
              KmsMasterKeyId: kmsMasterKeyId
            }
          : {}),
        ...(kmsDataKeyReusePeriodSeconds !== undefined
          ? {
              KmsDataKeyReusePeriodSeconds: kmsDataKeyReusePeriodSeconds
            }
          : {}),
        ...(deadLetterMessageRetentionPeriodSeconds !== undefined
          ? {
              MessageRetentionPeriod: deadLetterMessageRetentionPeriodSeconds
            }
          : {}),
        ...pascalCaseAllKeys(deadLetterQueueOverride)
      }
    });
  }

  /**
   * Add the event queue that will subscribe to the topic and collect the events
   * from SNS as they arrive, holding them for processing.
   *
   * @param {object} template the template which gets mutated
   * @param {{name, prefix, maxRetryCount, kmsMasterKeyId, kmsDataKeyReusePeriodSeconds, visibilityTimeout}} config including name of the queue,
   *  the resource prefix and the max retry count for message handler failures.
   */
  addEventQueue(
    template,
    {
      name,
      prefix,
      fifo,
      maxRetryCount,
      kmsMasterKeyId,
      kmsDataKeyReusePeriodSeconds,
      visibilityTimeout,
      mainQueueOverride,
      omitPhysicalId
    }: Config
  ) {
    const candidateQueueName = `${prefix}${name}Queue${fifo ? ".fifo" : ""}`;
    addResource(template, `${name}Queue`, {
      Type: "AWS::SQS::Queue",
      Properties: {
        ...(omitPhysicalId
          ? {}
          : { QueueName: validateQueueName(candidateQueueName) }),
        ...(fifo ? { FifoQueue: true } : {}),
        RedrivePolicy: {
          deadLetterTargetArn: {
            "Fn::GetAtt": [`${name}DeadLetterQueue`, "Arn"]
          },
          maxReceiveCount: maxRetryCount
        },
        ...(kmsMasterKeyId !== undefined
          ? {
              KmsMasterKeyId: kmsMasterKeyId
            }
          : {}),
        ...(kmsDataKeyReusePeriodSeconds !== undefined
          ? {
              KmsDataKeyReusePeriodSeconds: kmsDataKeyReusePeriodSeconds
            }
          : {}),
        ...(visibilityTimeout !== undefined
          ? {
              VisibilityTimeout: visibilityTimeout
            }
          : {}),
        ...pascalCaseAllKeys(mainQueueOverride)
      }
    });
  }

  /**
   * Add a policy allowing the queue to subscribe to the SNS topic.
   *
   * @param {object} template the template which gets mutated
   * @param {{name, prefix, eventBusArn}} config including name of the queue, the
   *  resource prefix and the arn of the topic
   */
  addEventQueuePolicy(template, { name, prefix, eventBusArn }: Config) {
    addResource(template, `${name}QueuePolicy`, {
      Type: "AWS::SQS::QueuePolicy",
      Properties: {
        PolicyDocument: {
          Version: "2012-10-17",
          Id: `${prefix}${name}Queue`,
          Statement: [
            {
              Sid: `${prefix}${name}Sid`,
              Effect: "Allow",
              Principal: { Service: "sns.amazonaws.com" },
              Action: "SQS:SendMessage",
              Resource: { "Fn::GetAtt": [`${name}Queue`, "Arn"] },
              Condition: { ArnEquals: { "aws:SourceArn": [eventBusArn] } }
            }
          ]
        },
        Queues: [{ Ref: `${name}Queue` }]
      }
    });
  }

  /**
   * Subscribe the newly created queue to the desired topic.
   *
   * @param {object} template the template which gets mutated
   * @param {{name, eventBusArn, pattern}} config including name of the queue,
   *  the arn of the topic and the filter policy for the subscription
   */
  addTopicSubscription(
    template,
    {
      name,
      eventBusArn,
      pattern,
      rawMessageDelivery,
      subscriptionOverride
    }: Config
  ) {
    addResource(template, `Subscribe${name}Topic`, {
      Type: "AWS::SNS::Subscription",
      Properties: {
        Endpoint: { "Fn::GetAtt": [`${name}Queue`, "Arn"] },
        Protocol: "sqs",
        eventBusArn: eventBusArn,
        ...(pattern ? { Pattern: pattern } : {}),
        ...(rawMessageDelivery !== undefined
          ? {
              RawMessageDelivery: rawMessageDelivery
            }
          : {}),
        ...pascalCaseAllKeys(subscriptionOverride)
      }
    });
  }

  /**
   * Add permissions so that the SQS handler can access the queue.
   *
   * @param {object} template the template which gets mutated
   * @param {{name, prefix}} config the name of the queue the lambda is subscribed to
   */
  addLambdaSqsPermissions(template, { name, kmsMasterKeyId }) {
    if (template.Resources.IamRoleLambdaExecution === undefined) {
      // The user has set their own custom role ARN so the Serverless generated role is not generated
      // We can safely skip this step because the owner of the custom role ARN is responsible for setting
      // this the relevant policy to allow the lambda to access the queue.
      return;
    }

    template.Resources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument.Statement.push(
      {
        Effect: "Allow",
        Action: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ],
        Resource: [
          { "Fn::GetAtt": [`${name}Queue`, "Arn"] },
          { "Fn::GetAtt": [`${name}DeadLetterQueue`, "Arn"] }
        ]
      }
    );

    if (kmsMasterKeyId !== undefined && kmsMasterKeyId !== null) {
      // TODO: Should we rename kmsMasterKeyId to make it clearer that it can accept an ARN?
      const resource =
        // If the key ID is an object, it is most likely a "Ref" or "GetAtt" so we should pass it straight through so it gets resolved by CloudFormation
        // If an ARN is provided, pass it straight through too, because no processing is needed
        // Otherwise if it isn't either of those things, it is probably an ID, so we need to
        // transform it to an ARN to make the policy valid
        typeof kmsMasterKeyId === "object" || isKmsArn(kmsMasterKeyId)
          ? kmsMasterKeyId
          : `arn:aws:kms:::key/${kmsMasterKeyId}`;
      template.Resources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument.Statement.push(
        {
          Effect: "Allow",
          Action: ["kms:Decrypt"],
          Resource: resource
        }
      );
    }
  }
}
