# Serverless Eventbridge Sqs Lambda

This is a servless plugin which allows you to subscribe a lambda to an SQS queue which is driven by an EventBridge event

# Table of Contents

- [Install](#install)
- [Setup](#setup)

## Install

Run `npm install` in your Serverless project.

`$ npm install --save-dev @spritz/eventbridge-sqs`

Add the plugin to your serverless.yml file

```yml
plugins:
  - "@spritz/eventbridge-sqs"
```

## Setup

Provide the lambda function with the eventBridgeSqs event

```yml
functions:
  processEvent:
    handler: handler.handler
    events:
      - eventBridgeSqs:
          eventBus: MyEventBusARN # Optional - by default will listen to the default bus
          pattern: # Optional - by default will listen to all events
            detail-type:
              - user.login
          batchSize: 1 # optional - default value is 1
          visibilityTimeout: 120 # optional (in seconds) - AWS default is 30 secs

plugins:
  - "@spritz/eventbridge-sqs"
```
