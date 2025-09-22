# Juicy Wines — Quarterly Taxes Dataset

This JSON is structured for easy plotting of quarterly lines (PIT, VAT, CIT). Values are in VND; negative = refunds/credits.

## File
- `juicy_wines.json` — normalized quarterly data with schema in the `meta` section.

## Schema
Each record in `data`:
- `year`: number (e.g., 2024)
- `quarter`: one of `Q1|Q2|Q3|Q4`
- `PIT`, `VAT`, `CIT`: number or null. Use positive amounts for payable, negative for refunds/credits, null if unknown.

Aliases: `Corporation` == `CIT`.

## Example usage (ECharts)
```js
import data from './juicy_wines.json';

const quarters = data.data.filter(d => d.year === 2024).map(d => d.quarter);
const pit = data.data.filter(d => d.year === 2024).map(d => d.PIT);
const vat = data.data.filter(d => d.year === 2024).map(d => d.VAT);
const cit = data.data.filter(d => d.year === 2024).map(d => d.CIT);

const option = {
  tooltip: { trigger: 'axis', valueFormatter: v => v?.toLocaleString('en-US') + ' VND' },
  legend: { data: ['PIT', 'VAT', 'CIT'] },
  xAxis: { type: 'category', data: quarters },
  yAxis: { type: 'value' },
  series: [
    { name: 'PIT', type: 'line', data: pit },
    { name: 'VAT', type: 'line', data: vat },
    { name: 'CIT', type: 'line', data: cit }
  ]
};
```

## Example usage (Chart.js)
```js
import json from './juicy_wines.json';
const rows = json.data.filter(d => d.year === 2024);
const labels = rows.map(r => r.quarter);
const dataset = (key, color) => ({
  label: key,
  data: rows.map(r => r[key]),
  borderColor: color,
  spanGaps: true,
});

new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      dataset('PIT', '#f39c12'),
      dataset('VAT', '#27ae60'),
      dataset('CIT', '#2980b9'),
    ]
  },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    parsing: false,
    scales: { y: { ticks: { callback: v => v.toLocaleString('en-US') } } },
  }
});
```

## Filling the data
- 2024 quarterly PIT and VAT were prefilled from the screenshot; adjust if needed.
- 2025 Q1–Q2 PIT/VAT added; CIT has a Q4 placeholder based on the visible row (271,800). Update as you validate source numbers.
- Set any missing value to `null` to create gaps in line charts.
