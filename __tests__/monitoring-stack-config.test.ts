import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OPS_STATUS_SERVICE_IDS } from "@/lib/monitoring/ops-client";

const ROOT = join(process.cwd(), "config", "monitoring");

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("monitoring data plane configuration", () => {
  it("pins the reviewed images and exposes host ports on loopback only", () => {
    const compose = read("compose.yml");

    for (const image of [
      "prom/prometheus:v3.5.0",
      "grafana/loki:3.5.3",
      "grafana/tempo:2.8.2",
      "grafana/grafana:12.1.1",
      "grafana/alloy:v1.10.1",
      "prom/alertmanager:v0.28.1",
      "prometheuscommunity/postgres-exporter:v0.17.1",
    ]) {
      expect(compose).toContain(`image: ${image}`);
    }

    const publishedPorts = [...compose.matchAll(/-\s*"([^"]+:\d+)"\s*$/gm)].map((match) => match[1]);
    expect(publishedPorts.length).toBeGreaterThan(0);
    expect(publishedPorts.every((port) => port.startsWith("127.0.0.1:"))).toBe(true);
    expect(publishedPorts).toContain("127.0.0.1:3101:3100");
    expect(compose).not.toMatch(/-\s*"\d+:\d+"/);
  });

  it("keeps state in named volumes and bounds each container", () => {
    const compose = read("compose.yml");

    for (const volume of [
      "prometheus_data",
      "loki_data",
      "tempo_data",
      "grafana_data",
      "alertmanager_data",
      "alloy_data",
    ]) {
      expect(compose).toContain(`${volume}:`);
      expect(compose).toContain(`${volume}:/`);
    }

    expect((compose.match(/healthcheck:/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect((compose.match(/memory:/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it("scrapes every 15 seconds with a token and retains metrics for 30 days", () => {
    const compose = read("compose.yml");
    const prometheus = read("prometheus/prometheus.yml");

    expect(prometheus).toContain("scrape_interval: 15s");
    expect(prometheus).toContain("/api/internal/admin-metrics");
    expect(prometheus).toContain("credentials_file: /run/secrets/internal_metrics_token");
    expect(compose).toContain("--storage.tsdb.retention.time=30d");
    expect(compose).toContain("INTERNAL_METRICS_TOKEN");
  });

  it("enables Loki retention deletion and applies separate audit retention", () => {
    const loki = read("loki/loki.yml");

    expect(loki).toContain("retention_enabled: true");
    expect(loki).toContain("delete_request_store: filesystem");
    expect(loki).toContain("retention_period: 360h");
    expect(loki).toMatch(/selector:\s*'\{log_class="error"\}'[\s\S]*priority:\s*2[\s\S]*period:\s*720h/);
    expect(loki).toMatch(/selector:\s*'\{log_class="audit"\}'[\s\S]*priority:\s*3[\s\S]*period:\s*4320h/);
  });

  it("retains traces for 14 days and receives OTLP through Alloy", () => {
    const tempo = read("tempo/tempo.yml");
    const alloy = read("alloy/config.alloy");

    expect(tempo).toContain("block_retention: 336h");
    expect(alloy).toContain('otelcol.receiver.otlp "inkvia"');
    expect(alloy).toContain('endpoint = "0.0.0.0:4317"');
    expect(alloy).toContain('endpoint = "0.0.0.0:4318"');
    expect(alloy).toContain('otelcol.exporter.otlp "tempo"');
    expect(alloy).toContain('endpoint = "tempo:4317"');
    expect(alloy).toContain('loki.write "local"');
    expect(alloy).toContain('url = "http://loki:3100/loki/api/v1/push"');
  });

  it("labels every selectable service log with the exact service id used by the panel", () => {
    const alloy = read("alloy/config.alloy");

    for (const service of OPS_STATUS_SERVICE_IDS) {
      expect(alloy).toMatch(new RegExp(`"service"\\s*=\\s*"${service}"`));
    }
    expect(alloy).not.toMatch(/"service"\s*=\s*"application"/);
  });

  it("keeps alerts inside the panel and provisions all Grafana data sources", () => {
    const alertmanager = read("alertmanager/alertmanager.yml");
    const datasources = read("grafana/provisioning/datasources/datasources.yml");
    const dashboards = read("grafana/provisioning/dashboards/dashboards.yml");

    expect(alertmanager).toContain("receiver: panel-only");
    expect(alertmanager).not.toMatch(/webhook_configs|email_configs|slack_configs|wechat_configs|pagerduty_configs/);
    for (const type of ["prometheus", "loki", "tempo", "alertmanager"]) {
      expect(datasources).toContain(`type: ${type}`);
    }
    expect(dashboards).toContain("/var/lib/grafana/dashboards");
  });

  it("contains service labels and no committed credentials", () => {
    const files = [
      "compose.yml",
      "prometheus/prometheus.yml",
      "prometheus/rules/inkvia.yml",
      "loki/loki.yml",
      "tempo/tempo.yml",
      "alloy/config.alloy",
      "alertmanager/alertmanager.yml",
      "grafana/provisioning/datasources/datasources.yml",
    ].map(read).join("\n");

    expect(files).toContain("service");
    expect(files).not.toMatch(/Bearer[ \t]+[A-Za-z0-9._-]{12,}/);
    expect(files).not.toMatch(/^[ \t]*password:[ \t]*(?!\$\{|<|$)[^\s#]+/gm);
    expect(files).not.toContain("change-me");
  });
});
