# Serverless Eventbridge Sqs Lambda

Introducing an SQS interface between AWS EventBridge and Lambda, as facilitated by this plugin, which enhances system resilience. While EventBridge alone can trigger Lambda functions, it lacks SQS's built-in capabilities for message buffering, deduplication, and fault tolerance. Without SQS, you're reliant solely on Lambda’s limited retry mechanisms. By using this plugin, you ensure that your architecture can gracefully handle surges in events and more effectively manage event-processing failures, making your serverless applications both scalable and robust.

# Table of Contents

- [Install](#install)
- [Setup](#setup)

## Installation

Install the plugin in the root directory of your Serverless project with the following npm command:

`$ npm install --save-dev @spritz-finance/serverless-eventbridge-sqs`

Next, incorporate the plugin into your serverless.yml file as demonstrated below:

```yml
plugins:
  - "@spritz-finance/serverless-eventbridge-sqs"
```

## Setup

To complete the setup, configure your Lambda function with the eventBridgeSqs event type in your serverless.yml file. Below is an example that illustrates how to set up the function with various options. Note that all settings are optional

```yml
functions:
  processEvent:
    handler: handler.handler
    events:
      - eventBridgeSqs:
          # EventBridge settings
          eventBus: MyEventBusARN # Defaults to listening on the default event bus
          pattern: # Defaults to listening to all events
            detail-type:
              - user.login
          inputTransformer: # Transform the incoming event data
            inputTemplate: '{"newAttribute": "$.oldAttribute"}'

          # SQS settings
          batchSize: 1 # The default batch size is 1
          visibilityTimeout: 120 # AWS default is 30 secs
          messageRetentionPeriod: 345600 # 4 days in seconds
          delaySeconds: 10 # Initial delay before delivering the message. Default is 0
          redrivePolicy: # Integrate with a Dead Letter Queue
            deadLetterTargetArn: MyDLQARN
          encryption: # Enable encryption for messages
            kmsMasterKeyId: alias/aws/sqs
            kmsDataKeyReusePeriodSeconds: 600

plugins:
  - "@spritz-finance/serverless-eventbridge-sqs"
```

The above configuration shows that the processEvent Lambda function is subscribed to an SQS queue that listens for events on the `MyEventBusARN` event bus. The function filters these events with a `detail-type` of `user.login`. Moreover, it sets a batch size of 1 and a visibility timeout of 120 seconds for processed messages.
