interface BarChartProps {
  data: Array<{ label: string; value: number }>;
  height?: number;
}

export function BarChart({ data, height = 160 }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height }}>
      {data.map((d) => (
        <div key={d.label} style={{ flex: 1, textAlign: "center" }}>
          <div
            title={`${d.label}: ${d.value}`}
            style={{
              height: Math.max(2, (d.value / max) * (height - 28)),
              background: "#8a6d3b",
              borderRadius: 4,
            }}
          />
          <div style={{ fontSize: 10, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>
            {d.label}
          </div>
        </div>
      ))}
    </div>
  );
}
