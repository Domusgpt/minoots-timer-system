import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

const defaultEndpoint = 'http://localhost:4318/v1/traces';

export const initTelemetry = async (): Promise<void> => {
  if (sdk) {
    return;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? defaultEndpoint;
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'minoots-control-plane';
  const environment = process.env.NODE_ENV ?? 'development';

  const resource = resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  await sdk.start();
};

export const shutdownTelemetry = async (): Promise<void> => {
  if (!sdk) {
    return;
  }
  await sdk.shutdown();
  sdk = undefined;
};
