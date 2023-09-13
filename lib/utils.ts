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
): void => {
  if (logicalId in template.Resources) {
    throw new Error(
      `Generated logical ID [${logicalId}] already exists in resources definition. Ensure that the snsSqs event definition has a unique name property.`
    );
  }
  template.Resources[logicalId] = resourceDefinition;
};


