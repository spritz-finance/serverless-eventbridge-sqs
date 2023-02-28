import { JsonObject } from "type-fest";

/**
 * A regular expression that matches AWS KMS arns
 */
const kmsArnRegex = /^arn:aws:kms:.*:.*:key\/.+$/;

/**
 * Parse a value into a number or set it to a default value.
 *
 * @param {string|number|null|undefined} intString value possibly in string
 * @param {*} defaultInt the default value if `intString` can't be parsed
 */
export const parseIntOr = (intString, defaultInt) => {
  if (intString === null || intString === undefined) {
    return defaultInt;
  }
  try {
    return parseInt(intString.toString(), 10);
  } catch {
    return defaultInt;
  }
};

/**
 * Converts a string from camelCase to PascalCase. Basically, it just
 * capitalises the first letter.
 *
 * @param {string} camelCase camelCase string
 */
export const pascalCase = (camelCase: string): string =>
  camelCase.slice(0, 1).toUpperCase() + camelCase.slice(1);

export const pascalCaseAllKeys = (jsonObject: JsonObject): JsonObject =>
  Object.keys(jsonObject).reduce(
    (acc, key) => ({
      ...acc,
      [pascalCase(key)]: jsonObject[key]
    }),
    {}
  );

export const validateQueueName = (queueName: string): string => {
  if (queueName.length > 80) {
    throw new Error(
      `Generated queue name [${queueName}] is longer than 80 characters long and may be truncated by AWS, causing naming collisions. Try a shorter prefix or name, or try the hashQueueName config option.`
    );
  }
  return queueName;
};

/**
 * Returns true if the provided string looks like an KMS ARN, otherwise false
 * @param possibleArn the candidate string
 * @returns true if the provided string looks like a KMS ARN, otherwise false
 */
export const isKmsArn = (possibleArn: string): boolean =>
  kmsArnRegex.test(possibleArn);

/**
 * Adds a resource block to a template, ensuring uniqueness.
 * @param template the serverless template
 * @param logicalId the logical ID (resource key) for the resource
 * @param resourceDefinition the definition of the resource
 */
export const addResource = (
  template: any,
  logicalId: string,
  resourceDefinition: Record<string, unknown>
) => {
  if (logicalId in template.Resources) {
    throw new Error(
      `Generated logical ID [${logicalId}] already exists in resources definition. Ensure that the snsSqs event definition has a unique name property.`
    );
  }
  template.Resources[logicalId] = resourceDefinition;
};
