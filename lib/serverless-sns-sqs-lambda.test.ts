"use strict";

import CLI from "serverless/lib/classes/cli";
import Serverless from "serverless/lib/serverless";
import AwsProvider from "serverless/lib/plugins/aws/provider";
import ServerlesseventBridgeSqsLambda from "./serverless-sns-sqs-lambda";
// See https://github.com/serverless/test/blob/71746cd0e0c897de50e19bc96a3968e5f26bee4f/docs/run-serverless.md for more info on run-serverless
import runServerless from "@serverless/test/run-serverless";
import { join } from "path";

const serverlessPath = join(__dirname, "../node_modules/serverless");

const slsOpt = {
  region: "ap-southeast-2"
};

/**
 * Returns a resource that looks like what Serverless generates when not using
 * a custom execution role ARN.
 *
 * It would be better to get Serverless to generate this for us but we don't
 * run in a serverless context at the moment so this is the best we have.
 */
const generateIamLambdaExecutionRole = () => ({
  IamRoleLambdaExecution: {
    Type: "AWS::IAM::Role",
    Properties: {
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: ["lambda.amazonaws.com"]
            },
            Action: ["sts:AssumeRole"]
          }
        ]
      },
      Policies: [
        {
          PolicyName: {
            "Fn::Join": ["-", ["sns-sqs-service", "dev-sd", "lambda"]]
          },
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: []
          }
        }
      ],
      Path: "/",
      RoleName: {
        "Fn::Join": [
          "-",
          [
            "sns-sqs-service",
            "dev-sd",
            {
              Ref: "AWS::Region"
            },
            "lambdaRole"
          ]
        ]
      }
    }
  }
});

describe("Test Serverless SNS SQS Lambda", () => {
  let serverless;
  let serverlesseventBridgeSqsLambda;

  afterEach(() => {
    jest.resetModules(); // reset modules after each test
  });

  describe("when the provider is specified via a command line option", () => {
    const baseConfig = {
      service: "test-service",
      configValidationMode: "error",
      frameworkVersion: "*",
      provider: {
        ...slsOpt,
        name: "aws",
        runtime: "nodejs14.x",
        stage: "dev-test"
      },
      package: {
        // This is simply here to prevent serverless from trying to package
        // any files. Since the config is generated in unique temp directories
        // for each test, there are no files to resolve for packaging
        // so providing a "pre-built" artefact with an absolute path
        // keeps serverless happy
        artifact: require.resolve("./__fixtures__/handler.js")
      },
      plugins: [require.resolve("../dist")]
    };

    it("should fail if name is not passed", async () => {
      expect.assertions(1);

      await expect(() =>
        runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              processEvent: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
                      name: undefined
                    }
                  }
                ]
              }
            }
          }
        })
      ).rejects.toMatchInlineSnapshot(`
              [ServerlessError: Configuration error at 'functions.processEvent.events.0.eventBridgeSqs': must have required property 'name'

              Learn more about configuration validation here: http://slss.io/configuration-validation]
            `);
    });

    it("should fail if eventBusArn is not passed", async () => {
      expect.assertions(1);

      await expect(() =>
        runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              processEvent: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      eventBusArn: undefined,
                      name: "some name"
                    }
                  }
                ]
              }
            }
          }
        })
      ).rejects.toMatchInlineSnapshot(`
              [ServerlessError: Configuration error at 'functions.processEvent.events.0.eventBridgeSqs': must have required property 'eventBusArn'

              Learn more about configuration validation here: http://slss.io/configuration-validation]
            `);
    });

    it("should fail if eventBusArn is invalid", async () => {
      expect.assertions(1);

      await expect(() =>
        runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              processEvent: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      eventBusArn: "not_an_arn",
                      name: "some name"
                    }
                  }
                ]
              }
            }
          }
        })
      ).rejects.toMatchInlineSnapshot(`
              [ServerlessError: Configuration error at 'functions.processEvent.events.0.eventBridgeSqs.eventBusArn': unsupported string format

              Learn more about configuration validation here: http://slss.io/configuration-validation]
            `);
    });

    describe("when no optional parameters are provided", () => {
      it("should produce valid SQS CF template items", async () => {
        const { cfTemplate } = await runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              ["test-function"]: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      name: "some-name",
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
                    }
                  }
                ]
              }
            }
          }
        });

        expect(cfTemplate).toMatchSnapshot({
          Resources: {
            TestDashfunctionLambdaFunction: {
              Properties: {
                Code: { S3Key: expect.any(String) }
              }
            }
          }
        });
      });
    });

    describe("when all parameters are provided", () => {
      it("should produce valid SQS CF template items", async () => {
        const { cfTemplate } = await runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              ["test-function"]: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      name: "some-name",
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
                      batchSize: 7,
                      maximumBatchingWindowInSeconds: 99,
                      prefix: "some prefix",
                      maxRetryCount: 4,
                      kmsMasterKeyId: "some key",
                      kmsDataKeyReusePeriodSeconds: 200,
                      deadLetterMessageRetentionPeriodSeconds: 1209600,
                      enabled: false,
                      visibilityTimeout: 999,
                      rawMessageDelivery: true,
                      pattern: { pet: ["dog", "cat"] }
                    }
                  }
                ]
              }
            }
          }
        });

        expect(cfTemplate).toMatchSnapshot({
          Resources: {
            TestDashfunctionLambdaFunction: {
              Properties: {
                Code: { S3Key: expect.any(String) }
              }
            }
          }
        });
      });
    });

    describe("when encryption parameters are not provided", () => {
      it("should produce valid SQS CF template items", async () => {
        const { cfTemplate } = await runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              ["test-function"]: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      name: "some-name",
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
                      prefix: "some prefix",
                      maxRetryCount: 4
                    }
                  }
                ]
              }
            }
          }
        });

        expect(cfTemplate).toMatchSnapshot({
          Resources: {
            TestDashfunctionLambdaFunction: {
              Properties: {
                Code: { S3Key: expect.any(String) }
              }
            }
          }
        });
      });
    });

    describe("when overriding the generated CloudFormation template", () => {
      it("the overrides should take precedence", async () => {
        const { cfTemplate } = await runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              ["test-function"]: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      name: "some-name",
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
                      prefix: "some prefix",
                      maxRetryCount: 4,
                      enabled: true,
                      visibilityTimeout: 1234,
                      deadLetterMessageRetentionPeriodSeconds: 120,
                      rawMessageDelivery: true,
                      mainQueueOverride: {
                        visibilityTimeout: 4321
                      },
                      deadLetterQueueOverride: {
                        MessageRetentionPeriod: 1000
                      },
                      eventSourceMappingOverride: {
                        Enabled: false
                      },
                      subscriptionOverride: {
                        rawMessageDelivery: false
                      }
                    }
                  }
                ]
              }
            }
          }
        });

        expect(cfTemplate).toMatchSnapshot({
          Resources: {
            TestDashfunctionLambdaFunction: {
              Properties: {
                Code: { S3Key: expect.any(String) }
              }
            }
          }
        });
      });
    });

    describe("when fifo is true", () => {
      it("should produce valid fifo queues", async () => {
        const { cfTemplate } = await runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            functions: {
              ["test-function"]: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      name: "some-name",
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
                      fifo: true
                    }
                  }
                ]
              }
            }
          }
        });

        expect(cfTemplate).toMatchSnapshot({
          Resources: {
            TestDashfunctionLambdaFunction: {
              Properties: {
                Code: { S3Key: expect.any(String) }
              }
            }
          }
        });
      });
    });

    describe("when a custom role ARN is specified", () => {
      it("it should not crash and just skip creating the policies", async () => {
        const { cfTemplate } = await runServerless(serverlessPath, {
          command: "package",
          config: {
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              iam: {
                role: "arn:aws:iam::123456789012:role/execution-role",
                deploymentRole: "arn:aws:iam::123456789012:role/deploy-role"
              }
            },
            functions: {
              ["test-function"]: {
                handler: "handler.handler",
                events: [
                  {
                    eventBridgeSqs: {
                      name: "some-name",
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
                    }
                  }
                ]
              }
            }
          }
        });

        expect(cfTemplate).toMatchSnapshot({
          Resources: {
            TestDashfunctionLambdaFunction: {
              Properties: {
                Code: { S3Key: expect.any(String) }
              }
            }
          }
        });
      });
    });
  });

  describe("when the provider is specified via a config option in serverless.yml", () => {
    beforeEach(() => {
      serverless = new Serverless({ commands: [], options: {} });
      serverless.service.service = "test-service";
      // This should really be a proper instance of the Config class. See also: https://github.com/agiledigital/serverless-sns-sqs-lambda/issues/313
      serverless.config = { stage: "dev-test-config" };

      const options = {
        ...slsOpt
      };

      const provider = new AwsProvider(serverless);
      serverless.setProvider("aws", provider);

      serverless.cli = new CLI(serverless);
      serverlesseventBridgeSqsLambda = new ServerlesseventBridgeSqsLambda(
        serverless,
        options
      );
    });

    describe("when no optional parameters are provided", () => {
      it("should produce valid SQS CF template items", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testConfig = {
          name: "some-name",
          eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
        };
        const validatedConfig = serverlesseventBridgeSqsLambda.validateConfig(
          "test-function",
          serverlesseventBridgeSqsLambda.stage,
          testConfig
        );
        serverlesseventBridgeSqsLambda.addEventQueue(template, validatedConfig);
        serverlesseventBridgeSqsLambda.addEventDeadLetterQueue(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addEventSourceMapping(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addTopicSubscription(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addLambdaSqsPermissions(
          template,
          validatedConfig
        );

        expect(template).toMatchSnapshot();
      });
    });

    describe("when fifo is true", () => {
      it("should produce valid fifo queues", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testConfig = {
          name: "some-name",
          eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
          fifo: true
        };
        const validatedConfig = serverlesseventBridgeSqsLambda.validateConfig(
          "test-function",
          serverlesseventBridgeSqsLambda.stage,
          testConfig
        );
        serverlesseventBridgeSqsLambda.addEventQueue(template, validatedConfig);
        serverlesseventBridgeSqsLambda.addEventDeadLetterQueue(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addEventSourceMapping(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addTopicSubscription(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addLambdaSqsPermissions(
          template,
          validatedConfig
        );

        expect(template).toMatchSnapshot();
      });
    });
  });

  describe("when the provider is specified via a provider option in serverless.yml", () => {
    beforeEach(() => {
      serverless = new Serverless({ commands: [], options: {} });
      serverless.service.service = "test-service";

      const options = {
        ...slsOpt
      };

      const provider = new AwsProvider(serverless);
      serverless.setProvider("aws", provider);
      serverless.service.provider.stage = "dev-test-provider";

      serverless.cli = new CLI(serverless);
      serverlesseventBridgeSqsLambda = new ServerlesseventBridgeSqsLambda(
        serverless,
        options
      );
    });

    describe("when no optional parameters are provided", () => {
      it("should produce valid SQS CF template items", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testConfig = {
          name: "some-name",
          eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
        };
        const validatedConfig = serverlesseventBridgeSqsLambda.validateConfig(
          "test-function",
          serverlesseventBridgeSqsLambda.stage,
          testConfig
        );
        serverlesseventBridgeSqsLambda.addEventQueue(template, validatedConfig);
        serverlesseventBridgeSqsLambda.addEventDeadLetterQueue(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addEventSourceMapping(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addTopicSubscription(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addLambdaSqsPermissions(
          template,
          validatedConfig
        );

        expect(template).toMatchSnapshot();
      });
    });

    describe("when fifo is true", () => {
      it("should produce valid fifo queues", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testConfig = {
          name: "some-name",
          eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
          fifo: true
        };
        const validatedConfig = serverlesseventBridgeSqsLambda.validateConfig(
          "test-function",
          serverlesseventBridgeSqsLambda.stage,
          testConfig
        );
        serverlesseventBridgeSqsLambda.addEventQueue(template, validatedConfig);
        serverlesseventBridgeSqsLambda.addEventDeadLetterQueue(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addEventSourceMapping(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addTopicSubscription(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addLambdaSqsPermissions(
          template,
          validatedConfig
        );

        expect(template).toMatchSnapshot();
      });
    });
  });

  describe.only("when no provider is specified", () => {
    beforeEach(() => {
      serverless = new Serverless({ commands: [], options: {} });
      serverless.service.service = "test-service";

      const options = {
        ...slsOpt
      };
      const provider = new AwsProvider(serverless);
      serverless.setProvider("aws", provider);
      serverless.cli = new CLI(serverless);
      serverlesseventBridgeSqsLambda = new ServerlesseventBridgeSqsLambda(
        serverless,
        options
      );
    });

    describe.only("when no optional parameters are provided", () => {
      it("stage should default to 'dev'", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testConfig = {
          name: "some-name",
          eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
        };
        const validatedConfig = serverlesseventBridgeSqsLambda.validateConfig(
          "test-function",
          serverlesseventBridgeSqsLambda.stage,
          testConfig
        );
        serverlesseventBridgeSqsLambda.addEventQueue(template, validatedConfig);
        serverlesseventBridgeSqsLambda.addEventDeadLetterQueue(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addEventSourceMapping(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addTopicSubscription(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addLambdaSqsPermissions(
          template,
          validatedConfig
        );

        expect(template).toMatchSnapshot();
      });
    });

    describe("when fifo is true", () => {
      it("stage should default to 'dev'", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testConfig = {
          name: "some-name",
          eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
          fifo: true
        };
        const validatedConfig = serverlesseventBridgeSqsLambda.validateConfig(
          "test-function",
          serverlesseventBridgeSqsLambda.stage,
          testConfig
        );
        serverlesseventBridgeSqsLambda.addEventQueue(template, validatedConfig);
        serverlesseventBridgeSqsLambda.addEventDeadLetterQueue(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addEventSourceMapping(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addTopicSubscription(
          template,
          validatedConfig
        );
        serverlesseventBridgeSqsLambda.addLambdaSqsPermissions(
          template,
          validatedConfig
        );

        expect(template).toMatchSnapshot();
      });
    });

    describe("when there are duplicate names", () => {
      it("should throw", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testCase = {
          functions: {
            Fn1: {
              events: [
                {
                  eventBridgeSqs: {
                    name: "Event1",
                    eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
                  }
                }
              ]
            },
            Fn2: {
              events: [
                {
                  eventBridgeSqs: {
                    name: "Event1",
                    eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
                  }
                }
              ]
            }
          }
        } as const;

        const thunk = () => {
          serverlesseventBridgeSqsLambda.addeventBridgeSqsResources(
            template,
            "Fn1",
            "unit-test",
            testCase.functions.Fn1.events[0].eventBridgeSqs
          );
          serverlesseventBridgeSqsLambda.addeventBridgeSqsResources(
            template,
            "Fn2",
            "unit-test",
            testCase.functions.Fn2.events[0].eventBridgeSqs
          );
        };

        expect(thunk).toThrowErrorMatchingInlineSnapshot(
          `"Generated logical ID [Event1DeadLetterQueue] already exists in resources definition. Ensure that the eventBridgeSqs event definition has a unique name property."`
        );
      });
    });

    describe("when the generated queue names are too long (over 80 characters)", () => {
      describe("when omitPhysicalId is false", () => {
        it("should throw", () => {
          const template = {
            Resources: {
              ...generateIamLambdaExecutionRole()
            }
          };
          const testCase = {
            functions: {
              Fn1: {
                events: [
                  {
                    eventBridgeSqs: {
                      prefix: "something-really-long-that-puts-it-",
                      name: "over-80-characters-which-is-no-good",
                      eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic"
                    }
                  }
                ]
              }
            }
          } as const;

          const thunk = () => {
            serverlesseventBridgeSqsLambda.addeventBridgeSqsResources(
              template,
              "Fn1",
              "unit-test",
              testCase.functions.Fn1.events[0].eventBridgeSqs
            );
          };

          expect(thunk).toThrowErrorMatchingInlineSnapshot(
            `"Generated queue name [something-really-long-that-puts-it-over-80-characters-which-is-no-goodDeadLetterQueue] is longer than 80 characters long and may be truncated by AWS, causing naming collisions. Try a shorter prefix or name, or try the hashQueueName config option."`
          );
        });
      });
    });
    describe("when omitPhysicalId is true", () => {
      it("should omit the queue name so that AWS can generate a unique one which is 80 chars or less", () => {
        const template = {
          Resources: {
            ...generateIamLambdaExecutionRole()
          }
        };
        const testCase = {
          functions: {
            Fn1: {
              events: [
                {
                  eventBridgeSqs: {
                    prefix: "something-really-long-that-puts-it-",
                    name: "over-80-characters-which-is-no-good",
                    eventBusArn: "arn:aws:sns:us-east-2:123456789012:MyTopic",
                    omitPhysicalId: true
                  }
                }
              ]
            }
          }
        } as const;

        serverlesseventBridgeSqsLambda.addeventBridgeSqsResources(
          template,
          "Fn1",
          "unit-test",
          testCase.functions.Fn1.events[0].eventBridgeSqs
        );

        const regularQueueName =
          template.Resources["over-80-characters-which-is-no-goodQueue"]
            .Properties.QueueName;
        const deadLetterQueueName =
          template.Resources[
            "over-80-characters-which-is-no-goodDeadLetterQueue"
          ].Properties.QueueName;

        // AWS will do this for us
        expect(regularQueueName).toBeUndefined();
        expect(deadLetterQueueName).toBeUndefined();
      });
    });
  });
});
