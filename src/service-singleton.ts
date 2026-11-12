import { ComputerService } from "./core/service";

let servicePromise: Promise<ComputerService> | undefined;

/** One service instance per plugin process. */
export function getService(): Promise<ComputerService> {
  if (!servicePromise) servicePromise = ComputerService.create();
  return servicePromise;
}

export function resetServiceForTests(): void {
  servicePromise = undefined;
}
