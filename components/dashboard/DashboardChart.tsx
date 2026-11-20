"use client";

import { useEffect, useRef } from "react";

// Chart.js 4.4.1 — the exact build design/Dashboard.html uses — loaded once from jsDelivr at runtime
// (not installed as a package), pinned with Subresource Integrity.
const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
const CHART_JS_SRI = "sha384-9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg/P5HG5lF1urn4";

type ChartInstance = { destroy(): void };
type ChartStatic = {
  new (canvas: HTMLCanvasElement, config: unknown): ChartInstance;
  defaults: { font: { family: string }; color: string };
};
declare global {
  interface Window {
    Chart?: ChartStatic;
  }
}

let loader: Promise<ChartStatic> | null = null;
function loadChartJs(): Promise<ChartStatic> {
  if (window.Chart) return Promise.resolve(window.Chart);
  loader ??= new Promise<ChartStatic>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHART_JS_URL;
    s.integrity = CHART_JS_SRI;
    s.crossOrigin = "anonymous";
    s.async = true;
    s.onload = () => (window.Chart ? resolve(window.Chart) : reject(new Error("Chart.js missing")));
    s.onerror = () => {
      loader = null; // allow a retry on the next mount
      s.remove();
      reject(new Error("Chart.js failed to load"));
    };
    document.head.appendChild(s);
  });
  return loader;
}

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const egp = (n: number) =>
  "EGP " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PIE_TONES = ["--tone-teal", "--tone-green", "--tone-blue", "--tone-amber", "--tone-violet"];

type TooltipItem = { label: string; parsed: number & { y: number }; dataset: { label: string } };

export type DashboardChartProps =
  | {
      kind: "bar";
      labels: string[];
      datasets: { label: string; data: number[]; tone: string }[];
    }
  | {
      kind: "pie";
      labels: string[];
      values: number[];
      /** "egp" → "Name: EGP 1,234.00", "sold" → "Name: 12 sold" */
      unit: "egp" | "sold";
    };

function buildConfig(p: DashboardChartProps) {
  if (p.kind === "bar") {
    return {
      type: "bar",
      data: {
        labels: p.labels,
        datasets: p.datasets.map((d) => ({
          label: d.label,
          data: d.data,
          backgroundColor: cssVar(d.tone),
          borderRadius: 4,
        })),
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top" },
          tooltip: { callbacks: { label: (c: TooltipItem) => c.dataset.label + ": " + egp(c.parsed.y) } },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v: number) => v / 1000 + "k" },
            title: { display: true, text: "Amount" },
            grid: { color: cssVar("--border") },
          },
          x: { grid: { color: cssVar("--border") } },
        },
      },
    };
  }
  return {
    type: "pie",
    data: {
      labels: p.labels,
      datasets: [{ data: p.values, backgroundColor: PIE_TONES.map(cssVar), borderWidth: 0 }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: (c: TooltipItem) =>
              c.label + ": " + (p.unit === "egp" ? egp(c.parsed) : c.parsed + " sold"),
          },
        },
      },
    },
  };
}

export default function DashboardChart(props: DashboardChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const configKey = JSON.stringify(props);

  useEffect(() => {
    let chart: ChartInstance | undefined;
    let cancelled = false;
    loadChartJs()
      .then((Chart) => {
        if (cancelled || !ref.current) return;
        Chart.defaults.font.family = cssVar("--font-body").replace(/"/g, "");
        Chart.defaults.color = cssVar("--text-2");
        chart = new Chart(ref.current, buildConfig(JSON.parse(configKey) as DashboardChartProps));
      })
      .catch(() => {
        /* CDN unreachable: leave the empty chart area, as the design would */
      });
    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [configKey]);

  return (
    <div className="sp-chart">
      <canvas ref={ref} />
    </div>
  );
}
