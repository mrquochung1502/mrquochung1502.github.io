// Wrap everything so we can load data first
(async function main(){
  // Basic config
  const margin = { top: 20, right: 24, bottom: 40, left: 80 };
  const width = 960; // responsive via viewBox
  const height = 480;

  const colors = { PIT: '#f39c12', VAT: '#27ae60', CIT: '#2980b9' };

  const container = d3.select('#chart');
  const svg = container
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const plot = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // Load JSON only (historical data encoded quarterly)
  let dataJson;
  try {
    dataJson = await d3.json('./juicy_wines.json');
  } catch (e) {
    console.error('Failed to load juicy_wines.json', e);
    d3.select('#chart').append('p').text('Failed to load data.');
    return;
  }

  const meta = dataJson?.meta || {};
  const seriesKeys = meta.series || ['PIT', 'VAT', 'CIT'];

  // Flatten JSON as quarterly points per series
  const jsonRows = (dataJson?.data || []).flatMap(d => (
    seriesKeys.map(k => ({ year: +d.year, quarter: String(d.quarter), key: k, value: d[k] == null ? null : +d[k] }))
  )).filter(r => r.value != null);

  let years = Array.from(new Set(jsonRows.map(d => d.year))).sort((a,b)=>a-b);
  // Keep only last year and current year (2024, 2025)
  years = years.filter(y => y === 2024 || y === 2025);
  const quarters = ['Q1','Q2','Q3','Q4'];
  const x = d3.scalePoint().domain(quarters).range([0, innerW]).padding(0.5);

  // Build rows keyed by year+quarter for simple lookup in draw
  const byYQK = new Map(jsonRows.map(r => [`${r.year}-${r.quarter}-${r.key}`, r.value]));
  const rows = years.flatMap(year => quarters.map(q => ({
    year,
    quarter: q,
    PIT: byYQK.get(`${year}-${q}-PIT`) ?? null,
    VAT: byYQK.get(`${year}-${q}-VAT`) ?? null,
    CIT: byYQK.get(`${year}-${q}-CIT`) ?? null,
  })));

  if (!rows.some(r => seriesKeys.some(k => r[k] != null))) {
    d3.select('#chart').append('p').text('No data available.');
    return;
  }

  // Initial Y; will be updated on draw according to active tab
  const y = d3.scaleLinear().range([innerH, 0]);

  // Axes and grid
  plot.append('g')
    .attr('class', 'axis x')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x));

  plot.append('g')
    .attr('class', 'axis y')
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format(',')));

  plot.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-innerW).tickFormat(''))
    .selectAll('line')
    .attr('opacity', 0.5);

  // Generators and UI
  const lineGen = d3.line()
    .defined(d => d.value != null)
    .x(d => x(d.x))
    .y(d => y(d.value));

  const tooltip = d3.select('#tooltip');
  function showTooltip(html, event) {
    tooltip.style('opacity', 1)
      .html(html)
      .style('left', `${event.clientX + 10}px`)
      .style('top', `${event.clientY + 10}px`);
  }
  function hideTooltip() { tooltip.style('opacity', 0); }

  // Tabs to switch single series view
  const tabs = d3.select('#tabs');
  let activeKey = seriesKeys[0];
  const tabSel = tabs.selectAll('.tab')
    .data(seriesKeys)
    .enter()
    .append('button')
    .attr('class', d => `tab ${d === activeKey ? 'active' : ''}`)
    .text(d => d)
    .on('click', (e, key) => {
      activeKey = key;
      tabSel.classed('active', d => d === activeKey);
      draw();
    });

  function draw() {
    const key = activeKey;
    // Build one line per year, x is quarters only
    const brandRed = '#c0392b'; // PCA logo red
    const lightRed = '#e67e73'; // lighter red
    const yearColor = y => (y === 2025 ? brandRed : lightRed);

    const series = years.map(y => ({
      year: y,
      key,
      color: yearColor(y),
      data: quarters.map(q => ({ x: q, value: byYQK.get(`${y}-${q}-${key}`) ?? null }))
    }));

    // Update Y for the active key across all years
    const values = series.flatMap(s => s.data.map(d => d.value).filter(v => v != null));
    const [minV, maxV] = d3.extent(values);
    const pad = ((maxV - minV) * 0.08) || 1;
    y.domain([minV - pad, maxV + pad]).nice();

    // update axes with transition
    plot.select('.axis.y').transition().duration(300).call(d3.axisLeft(y).ticks(6).tickFormat(d3.format(',')));
    plot.select('.grid').transition().duration(300).call(d3.axisLeft(y).tickSize(-innerW).tickFormat(''));

  const lines = plot.selectAll('.series').data(series, d => `${d.key}-${d.year}`);

    lines.enter()
      .append('path')
      .attr('class', 'series')
      .attr('fill', 'none')
  .attr('stroke-width', 2)
  .attr('stroke', d => d.color)
  .merge(lines)
  .attr('d', d => lineGen(d.data));

    lines.exit().remove();

  const flatPoints = series.flatMap(s => s.data.filter(p => p.value != null).map(p => ({...p, seriesKey: s.key, year: s.year, color: s.color})));
  const pts = plot.selectAll('.pt').data(flatPoints, d => `${d.seriesKey}-${d.year}-${d.x}`);

    pts.enter()
      .append('circle')
      .attr('class', 'pt')
      .attr('r', 3)
      .attr('fill', d => d.color)
      .on('mousemove', function(event, d){
        const v = d.value.toLocaleString('en-US');
        showTooltip(`<strong>${key} • ${d.year}</strong><br>${d.x}: ${v} ${meta.currency || ''}`, event);
      })
      .on('mouseleave', hideTooltip)
      .merge(pts)
      .attr('cx', d => x(d.x))
      .attr('cy', d => y(d.value));

    pts.exit().remove();

    // Labels on each point
    const labels = plot.selectAll('.pt-label').data(flatPoints, d => `${d.seriesKey}-${d.year}-${d.x}`);
    labels.enter()
      .append('text')
      .attr('class', 'pt-label')
      .attr('text-anchor', 'middle')
      .attr('dy', -6)
      .style('font-size', '10px')
      .style('fill', '#333')
      .merge(labels)
      .attr('x', d => x(d.x))
      .attr('y', d => y(d.value))
      .text(d => d.value.toLocaleString('en-US'));
    labels.exit().remove();

    // Year legend
    const legend = svg.selectAll('.year-legend').data([0]);
    const legendGEnter = legend.enter().append('g').attr('class', 'year-legend');
    const legendG = legendGEnter.merge(legend)
      .attr('transform', `translate(${width - margin.right - 140}, ${margin.top})`);
    const items = legendG.selectAll('g.item').data(series, d => d.year);
    const itemEnter = items.enter().append('g').attr('class', 'item');
    itemEnter.append('rect').attr('width', 10).attr('height', 10);
    itemEnter.append('text').attr('x', 16).attr('y', 9).style('font-size','12px');
    const mergedItems = itemEnter.merge(items);
    mergedItems.attr('transform', (d,i) => `translate(0, ${i*16})`);
    mergedItems.select('rect').attr('fill', d => d.color);
    mergedItems.select('text').text(d => d.year);
    items.exit().remove();
  }

  draw();
})();
