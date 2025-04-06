import { NodeSDK } from '@opentelemetry/sdk-node';
//import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { EnvConfig } from './config.js';

// Add your port and startServer to the Prometheus options
const promExporter = new PrometheusExporter({
    port: EnvConfig.prometheusExporter.port,
    endpoint: EnvConfig.prometheusExporter.endpoint,
}, () => console.log(`Prometheus scrape endpoint: http://localhost:${EnvConfig.prometheusExporter.port}${EnvConfig.prometheusExporter.endpoint}`,));

const sdk = new NodeSDK({
  //traceExporter: new ConsoleSpanExporter(),
  metricReader: promExporter,

  instrumentations: [getNodeAutoInstrumentations()],

  resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "TipALPH",
        [ATTR_SERVICE_VERSION]: EnvConfig.version,
  }),
});

sdk.start();

function stopMetricsSDK() {
    sdk.shutdown()
    .then(
        () => console.log("MetricsSDK shut down successfully"),
        (err) => console.log("Error shutting down MetricsSDK:", err)
    );
}

process.once('SIGINT', stopMetricsSDK);
process.once('SIGTERM', stopMetricsSDK);