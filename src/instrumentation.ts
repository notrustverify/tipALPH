/*
import opentelemetry from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

import { EnvConfig } from "./config.js";

const resource = Resource.default().merge(
  new Resource({
    [ATTR_SERVICE_NAME]: "TipALPH",
    [ATTR_SERVICE_VERSION]: EnvConfig.version,
  }),
);

// Add your port and startServer to the Prometheus options
const promExporter = new PrometheusExporter({
    port: EnvConfig.prometheusExporter.port,
    endpoint: EnvConfig.prometheusExporter.endpoint,
}, () => console.log(`Prometheus scrape endpoint: http://localhost:${EnvConfig.prometheusExporter.port}${EnvConfig.prometheusExporter.endpoint}`,));

// Creates MeterProvider and define it as default
const meterProvider = new MeterProvider({
    resource: resource,
    readers: [ promExporter ]
});

// Set this MeterProvider to be global to the app being instrumented.
opentelemetry.metrics.setGlobalMeterProvider(meterProvider)
*/

//import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import opentelemetry from '@opentelemetry/api';

import { EnvConfig } from "./config.js";
import { RequestOptions } from 'http';

const promExporter = new PrometheusExporter({
    port: EnvConfig.prometheusExporter.port,
    endpoint: EnvConfig.prometheusExporter.endpoint,
}, () => console.log(`Prometheus scrape endpoint: http://localhost:${EnvConfig.prometheusExporter.port}${EnvConfig.prometheusExporter.endpoint}`,));


const resource = Resource.default().merge(
    new Resource({
        [ATTR_SERVICE_NAME]: "TipALPH",
        [ATTR_SERVICE_VERSION]: EnvConfig.version,
    }),
);

const meterProvider = new MeterProvider({ 
    resource: resource,
    readers: [ promExporter ]
});

// Set this MeterProvider to be global to the app being instrumented.
opentelemetry.metrics.setGlobalMeterProvider(meterProvider)

const httpInstrumentation = new HttpInstrumentation({
    // Ignore requests for the metrics endpoint
    ignoreIncomingRequestHook: (request: RequestOptions) => {
        const requestIsPromEndpoint = `localhost:${EnvConfig.prometheusExporter.port}` == request.headers.host
            && "GET" == request.method;
        return requestIsPromEndpoint
    }
});
const netInstrumentation = new NetInstrumentation()

const sdk = new NodeSDK({
    autoDetectResources: true,
    instrumentations: [
        httpInstrumentation,
        netInstrumentation,
        //getNodeAutoInstrumentations()
    ],
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
