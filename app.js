// Wrap everything so we can load data first
(async function main(){
  // Basic config
  const margin = { top: 20, right: 160, bottom: 40, left: 80 };
  const width = 960; // responsive via viewBox
  const height = 480;

  // Readability constants (no behavior change)
  const DUR = 300; // ms, transition duration
  const GRID_OPACITY = 0.5;
  const LEGEND_PAD = 8;
  const LEGEND_RX = 6;
  const PLOT_FONT_SIZE = 10; // px for value labels
  // Line chart point styling
  const POINT_RADIUS = 6; // increased point size for PIT/VAT
  const POINT_LABEL_DY = -8; // lift labels slightly to avoid overlap
  const POINT_LABEL_DX = 6; // shift labels to the right of the point
  // CIT bar sizing
  const BAR_MIN = 36;
  const BAR_MAX = 160;
  const BAR_FRACTION = 0.85; // fraction of category spacing

  // Brand colors for year lines
  const BRAND = { now: '#c32817ff', last: '#ffe2deff' };

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
  const TAB_ORDER = ['VAT','PIT','CIT'];

  // Flatten JSON as quarterly points per series
  const jsonRows = (dataJson?.data || []).flatMap(d => (
    seriesKeys.map(k => ({ year: +d.year, quarter: String(d.quarter), key: k, value: d[k] == null ? null : +d[k] }))
  )).filter(r => r.value != null);

  // Formatter: negatives in parentheses, thousands with commas; optional currency suffix for tooltips
  // Formatter: Vietnamese style thousands (dot) and parentheses for negatives
  const fmt = (n, currencySuffix = '') => {
    if (n == null || Number.isNaN(n)) return '';
    const base = Math.abs(n).toLocaleString('vi-VN');
    const suf = currencySuffix ? ` ${currencySuffix}` : '';
    return n < 0 ? `(${base}${suf})` : `${base}${suf}`;
  };

  let years = Array.from(new Set(jsonRows.map(d => d.year))).sort((a,b)=>a-b);
  // Keep only last year and current year (2024, 2025) and order as Now (2025) first
  years = [2025, 2024].filter(y => years.includes(y));
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
  .call(d3.axisLeft(y).ticks(6).tickFormat(d => fmt(d)));

  plot.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-innerW).tickFormat(''))
    .selectAll('line')
  .attr('opacity', GRID_OPACITY);

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

  // Layout helper: make summary table match the chart's inner plot width (exclude left/right margins)
  function layoutSummary(tableSel){
    if (!tableSel || tableSel.empty()) return;
    const svgEl = svg.node();
    const summaryEl = d3.select('#summary').node();
    if (!svgEl || !summaryEl) return;
    const svgW = svgEl.getBoundingClientRect().width;
    const summaryW = summaryEl.getBoundingClientRect().width;
    const scale = svgW / width; // viewBox scale factor
    const leftPx = margin.left * scale;
    const rightPx = margin.right * scale;
    const targetW = Math.max(0, summaryW - leftPx - rightPx);
    tableSel.style('width', `${targetW}px`)
      .style('margin-left', `${leftPx}px`)
      .style('margin-right', `${rightPx}px`);
  }

  // Small pure helpers (keep logic identical; improves readability)
  function computeCITYears(rows){
    return Array.from(new Set(rows.filter(r => r.key === 'CIT').map(r => r.year)))
      .sort((a,b)=>a-b)
      .slice(-4);
  }
  function pickCITForYear(byMap, year){
    for (const q of ['Q4','Q3','Q2','Q1']){
      const v = byMap.get(`${year}-${q}-CIT`);
      if (v != null) return { value: v, quarter: q, provisional: q !== 'Q4' };
    }
    return null;
  }
  function calcBarWidth(positions, innerPlotW){
    const dx = positions.length >= 2 ? (positions[1] - positions[0]) : innerPlotW * 0.25;
    return Math.max(BAR_MIN, Math.min(BAR_MAX, dx * BAR_FRACTION));
  }
  function computeDiagnosis(prev, curr){
    if (prev == null || curr == null || prev === 0) return 'yellow';
    const changePct = Math.abs((curr - prev) / prev) * 100; // percentage magnitude
    if (changePct < 10) return 'green';
    if (changePct < 20) return 'yellow';
    return 'red';
  }

  // Tabs to switch single series view
  const tabs = d3.select('#tabs');
  const keyHasData = Object.fromEntries(seriesKeys.map(k => [k, rows.some(r => r[k] != null)]));
  const tabsData = TAB_ORDER.filter(k => seriesKeys.includes(k)).map(k => ({ key: k, enabled: keyHasData[k] }));
  let activeKey = (tabsData.find(d => d.enabled) || tabsData[0]).key;
  const tabSel = tabs.selectAll('.tab')
    .data(tabsData)
    .enter()
    .append('button')
    .attr('class', d => `tab ${d.key === activeKey ? 'active' : ''} ${d.enabled ? '' : 'disabled'}`)
    .text(d => d.key)
    .on('click', (e, d) => {
      if (!d.enabled) return;
      activeKey = d.key;
      tabSel.classed('active', x => x.key === activeKey);
      draw();
    });

  function draw() {
    const key = activeKey;
    const isCIT = key === 'CIT';
    // Build one line per year.
    const yearColor = y => (y === 2025 ? BRAND.now : BRAND.last);

    let series; // used for legend items
    let citBarsData = null; // used only for CIT rendering & scales
    let legendLatestYear = null; // for dynamic legend labels
    if (!isCIT) {
      // Quarterly axis
      x.domain(quarters);
      series = years.map(y => ({
        year: y,
        key,
        color: yearColor(y),
        data: quarters.map(q => ({ x: q, value: byYQK.get(`${y}-${q}-${key}`) ?? null }))
      }));
      legendLatestYear = Math.max(...years);
    } else {
      // CIT: annual axis, up to last 4 available years (now and previous 3)
      const axisYears = computeCITYears(jsonRows); // last up to 4 years
      const latestYear = axisYears.length ? axisYears[axisYears.length - 1] : null;
      legendLatestYear = latestYear;

      citBarsData = axisYears.map(y => {
        const picked = pickCITForYear(byYQK, y);
        if (!picked) return null;
        return {
          x: String(y),
          year: y,
          value: picked.value,
          quarter: picked.quarter,
          provisional: picked.provisional,
          color: (y === latestYear ? BRAND.now : BRAND.last)
        };
      }).filter(Boolean);

      // x-domain uses only years we have data for
      x.domain(citBarsData.map(d => d.x));

      // Legend: always include 'This year'; include 'Last year/recent years' only if there is at least one prior year
      if (latestYear != null) {
        series = [{ year: latestYear, key, color: BRAND.now, data: [] }];
        if ((citBarsData || []).some(d => d.year !== latestYear)) {
          series.push({ year: latestYear - 1, key, color: BRAND.last, data: [] });
        }
      } else {
        series = [];
      }
    }

    // Update Y for the active key across all years
    const values = isCIT
      ? (citBarsData ? citBarsData.map(d => d.value).filter(v => v != null) : [])
      : series.flatMap(s => s.data.map(d => d.value).filter(v => v != null));
    if (!values.length) {
      plot.selectAll('.series,.pt,.pt-label').remove();
      return;
    }
      const [minV, maxV] = d3.extent(values);
      if (isCIT) {
        const padTop = ((maxV - 0) * 0.08) || 1;
        y.domain([0, maxV + padTop]).nice();
      } else {
        const pad = ((maxV - minV) * 0.08) || 1;
        y.domain([minV - pad, maxV + pad]).nice();
      }

  // update axes with transition
  plot.select('.axis.y').transition().duration(DUR).call(d3.axisLeft(y).ticks(6).tickFormat(d => fmt(d)));
  plot.select('.axis.x').transition().duration(DUR).call(d3.axisBottom(x));
    plot.select('.grid').transition().duration(DUR).call(d3.axisLeft(y).tickSize(-innerW).tickFormat(''));

  if (!isCIT) {
      // Lines and points for PIT/VAT
      const lines = plot.selectAll('.series').data(series, d => `${d.key}-${d.year}`);
      const linesEnter = lines.enter()
        .append('path')
        .attr('class', 'series')
        .attr('fill', 'none')
        .attr('stroke-width', 2)
        .attr('stroke', d => d.color);
      const linesMerged = linesEnter.merge(lines)
        .attr('d', d => lineGen(d.data));
      // animate stroke drawing from left to right
      linesMerged.each(function(){
        try {
          const total = this.getTotalLength();
          if (!isFinite(total) || total <= 0) return;
          d3.select(this)
            .attr('stroke-dasharray', `${total} ${total}`)
            .attr('stroke-dashoffset', total)
            .transition()
            .duration(DUR)
            .ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0);
        } catch (e) { /* ignore */ }
      });
      lines.exit().remove();

      const flatPoints = series.flatMap(s => s.data.filter(p => p.value != null).map(p => ({...p, seriesKey: s.key, year: s.year, color: s.color})));
      const pts = plot.selectAll('.pt').data(flatPoints, d => `${d.seriesKey}-${d.year}-${d.x}`);
      pts.enter()
        .append('circle')
        .attr('class', 'pt')
  .attr('r', POINT_RADIUS)
        .attr('fill', d => d.color)
        .on('mousemove', function(event, d){
          const v = fmt(d.value, meta.currency || '');
          showTooltip(`<strong>${key} • ${d.year}</strong><br>${d.x}: ${v}`, event);
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
        .attr('text-anchor', 'start')
        .attr('dy', POINT_LABEL_DY)
        .attr('dx', POINT_LABEL_DX)
  .style('font-size', `${PLOT_FONT_SIZE}px`)
        .style('fill', '#333')
        .merge(labels)
        .attr('x', d => x(d.x))
        .attr('y', d => y(d.value))
        .attr('dx', POINT_LABEL_DX)
        .attr('text-anchor', 'start')
        .text(d => fmt(d.value));
      labels.exit().remove();

      // Remove CIT bars if any from previous state
      plot.selectAll('.bar-cit,.bar-label').remove();
    } else {
      // Bars for CIT (annual)
      const barsData = citBarsData || [];

      // Compute bar width based on spacing
    const positions = barsData.map(b => x(b.x)).filter(v => v != null);
  const barW = calcBarWidth(positions, innerW);

      const bars = plot.selectAll('.bar-cit').data(barsData, d => `${key}-${d.year}`);
      const barsEnter = bars.enter().append('rect').attr('class','bar-cit')
        .attr('x', d => x(d.x) - barW/2)
        .attr('width', barW)
        .attr('y', y(0))
        .attr('height', 0)
        .attr('fill', d => d.color)
        .on('mousemove', function(event, d){
          const v = fmt(d.value, meta.currency || '');
            const prov = d.provisional ? `<br>(Provisional – ${d.quarter})` : '';
          showTooltip(`<strong>${key} • ${d.year}</strong><br>${d.x}: ${v}${prov}`, event);
        })
        .on('mouseleave', hideTooltip);
      barsEnter.merge(bars)
        .attr('x', d => x(d.x) - barW/2)
        .attr('width', barW)
  .transition().duration(DUR)
        .attr('y', d => Math.min(y(d.value), y(0)))
        .attr('height', d => Math.abs(y(d.value) - y(0)));
      bars.exit().remove();

      // Labels on bars (two lines when provisional)
      const barLabels = plot.selectAll('.bar-label').data(barsData, d => `${key}-${d.year}`);
      const blEnter = barLabels.enter().append('text').attr('class','bar-label')
        .attr('text-anchor','middle')
  .style('font-size', `${PLOT_FONT_SIZE}px`)
        .style('fill','#333');
      const blMerged = blEnter.merge(barLabels)
        .attr('x', d => x(d.x))
        .attr('y', d => y(d.value) - 18)
        .each(function(d){
          const t = d3.select(this);
          t.selectAll('tspan').remove();
          t.append('tspan').text(fmt(d.value));
          if (d.provisional) t.append('tspan').attr('x', x(d.x)).attr('dy', '1.2em').text(`(Provisional – ${d.quarter})`);
        });
      barLabels.exit().remove();

      // Remove line/point artifacts when switching from other tabs
      plot.selectAll('.series,.pt,.pt-label').remove();
    }

  // Year legend (right side) — order: Now, Last year
  const legend = svg.selectAll('.year-legend').data([series]);
  const legendG = legend.enter().append('g').attr('class', 'year-legend').merge(legend);
  const itemHeight = 18;
  const legendHeight = itemHeight * series.length;
  const legendX = margin.left + innerW + 20; // right of plot
  const legendY = margin.top + (innerH - legendHeight) / 2; // vertically centered
  legendG.attr('transform', `translate(${legendX}, ${legendY})`);

  // Ensure content group for measuring bbox without including the frame
  const contentSel = legendG.selectAll('g.legend-content').data([null]);
  const contentEnter = contentSel.enter().append('g').attr('class','legend-content');
  const contentG = contentEnter.merge(contentSel);

  const items = contentG.selectAll('g.item').data(series, d => d.year);
  const itemEnter = items.enter().append('g').attr('class', 'item');
  itemEnter.append('rect').attr('width', 12).attr('height', 12).attr('y', 3).attr('rx', 2).attr('ry', 2);
  itemEnter.append('text').attr('x', 18).attr('y', 12).style('font-size','12px');
  const mergedItems = itemEnter.merge(items);
  mergedItems.attr('transform', (d,i) => `translate(0, ${i * itemHeight})`);
  mergedItems.select('rect').attr('fill', d => d.color);
  // label using dynamic latest year for clarity across CIT and other series
  mergedItems.select('text').text(d => {
    if (isCIT) {
      const isLatest = d.year === legendLatestYear;
      const countYears = (citBarsData || []).length;
      if (isLatest) {
        const latest = (citBarsData || []).find(b => b.year === legendLatestYear);
        const prov = latest && latest.provisional;
        return `This year${prov ? ' (Provisional)' : ''}`;
      }
      return countYears > 2 ? 'Last recent years' : 'Last year';
    }
    return d.year === legendLatestYear ? `This year (${d.year})` : `Last year (${d.year})`;
  });
  items.exit().remove();

  // Legend frame box sized to content
  const padBox = LEGEND_PAD;
  const bb = contentG.node().getBBox();
  let frame = legendG.select('rect.legend-frame');
  if (frame.empty()) {
    frame = legendG.insert('rect', ':first-child').attr('class','legend-frame');
  }
  frame
    .attr('x', bb.x - padBox)
    .attr('y', bb.y - padBox)
    .attr('width', Math.max(0, bb.width + padBox * 2))
    .attr('height', Math.max(0, bb.height + padBox * 2))
    .attr('rx', LEGEND_RX)
    .attr('ry', LEGEND_RX)
    .attr('fill', '#ffffff')
    .attr('stroke', '#dddddd');
  
  // --- Summary table below the chart ---
  // For the active index (tab), compute:
  // - now: the most recent available value across all quarters and years
  // - most recent: the previous available value before 'now'
  const chronological = [];
  for (const y of years) {
    for (const q of quarters) chronological.push({ y, q });
  }
  chronological.sort((a,b)=> a.y - b.y || quarters.indexOf(a.q) - quarters.indexOf(b.q));

  const k = activeKey;
  const vals = [];
  for (const step of chronological) {
    const v = byYQK.get(`${step.y}-${step.q}-${k}`);
    if (v != null) vals.push({ y: step.y, q: step.q, v });
  }
  let summary;
  // For CIT header annotation when current year is provisional
  let citHeaderQuarter = null;
  if (activeKey === 'CIT') {
    // Special CIT proportional comparison logic
    function qIndex(q){ return ['Q1','Q2','Q3','Q4'].indexOf(q) + 1; }
    const currentYear = Math.max(...years);
    const previousYear = currentYear - 1;
    // Find latest quarter for current year
    let currentQuarter = null, currentValue = null;
    for (const q of ['Q4','Q3','Q2','Q1']) {
      const v = byYQK.get(`${currentYear}-${q}-CIT`);
      if (v != null){ currentQuarter = q; currentValue = v; break; }
    }
    // Find latest quarter for previous year
    let prevQuarter = null, prevValue = null;
    for (const q of ['Q4','Q3','Q2','Q1']) {
      const v = byYQK.get(`${previousYear}-${q}-CIT`);
      if (v != null){ prevQuarter = q; prevValue = v; break; }
    }
    // If current year is provisional (not Q4) store quarter for header label
    if (currentValue != null && currentQuarter && currentQuarter !== 'Q4') {
      citHeaderQuarter = currentQuarter;
    }
    if (currentValue == null) {
      summary = [{ lastQuarter: prevValue? { value: prevValue }: null, now: null, delta: null, diagnose: 'yellow' }];
    } else if (prevValue == null) {
      summary = [{ lastQuarter: null, now: { value: currentValue }, delta: null, diagnose: 'yellow' }];
    } else {
      const curIdx = qIndex(currentQuarter);
      const prevIdx = qIndex(prevQuarter);
      const currentProvisional = currentQuarter !== 'Q4';
      const prevProvisional = prevQuarter !== 'Q4';
      let adjCurrent = currentValue;
      let adjPrev = prevValue;
      if (currentProvisional && !prevProvisional) {
        // Scale previous full year to same progress fraction
        adjPrev = prevValue * (curIdx / 4);
      } else if (!currentProvisional && prevProvisional) {
        // Scale current full year down to match previous provisional progress
        adjCurrent = currentValue * (prevIdx / 4);
      } else if (currentProvisional && prevProvisional) {
        // Harmonize to the lesser progress fraction for fair comparison
        const f = Math.min(curIdx, prevIdx);
        if (curIdx !== f) adjCurrent = currentValue * (f / curIdx);
        if (prevIdx !== f) adjPrev = prevValue * (f / prevIdx);
      }
      // Both final -> no scaling
      const delta = adjCurrent - adjPrev;
      const diagnoseColor = computeDiagnosis(adjPrev, adjCurrent);
      summary = [{
        lastQuarter: { value: adjPrev },
        now: { value: adjCurrent },
        delta,
        diagnose: diagnoseColor
      }];
    }
  } else {
    const nowEntry = vals[vals.length - 1] || null;
    const prevEntry = vals.length > 1 ? vals[vals.length - 2] : null;
    const delta = (nowEntry && prevEntry) ? (nowEntry.v - prevEntry.v) : null;
    let diagnoseColor = computeDiagnosis(prevEntry?.v, nowEntry?.v);
    summary = [{
      lastQuarter: prevEntry ? { value: prevEntry.v } : null,
      now: nowEntry ? { value: nowEntry.v } : null,
      delta,
      diagnose: diagnoseColor
    }];
  }

  const summarySel = d3.select('#summary');
  let table = summarySel.select('table');
  if (table.empty()) {
    table = summarySel.append('table');
  const thead = table.append('thead').append('tr');
  let headers;
  if (activeKey === 'CIT') {
    headers = ['Last year', 'This year', '', 'Diagnose'];
    if (citHeaderQuarter) {
      headers[0] += ` (${citHeaderQuarter})`;
      headers[1] += ` (${citHeaderQuarter})`;
    }
  } else {
    headers = ['Last quarter', 'This quarter', '', 'Diagnose'];
  }
  headers.forEach((h,i) => {
      const th = thead.append('th').text(h);
      if (h !== 'Diagnose') th.attr('class','num');
    });
    table.append('tbody');
  } else {
    // Always rebuild header to reflect active series semantics (CIT uses years)
    table.select('thead').remove();
    const thead = table.insert('thead', 'tbody').append('tr');
    let headers;
    if (activeKey === 'CIT') {
      headers = ['Last year', 'This year', '', 'Diagnose'];
      if (citHeaderQuarter) {
        headers[0] += ` (${citHeaderQuarter})`;
        headers[1] += ` (${citHeaderQuarter})`;
      }
    } else {
      headers = ['Last quarter', 'This quarter', '', 'Diagnose'];
    }
    headers.forEach((h,i) => {
      const th = thead.append('th').text(h);
      if (h !== 'Diagnose') th.attr('class','num');
    });
  }
  const tbody = table.select('tbody');
  const rowsSel = tbody.selectAll('tr').data(summary);
  const rowsEnter = rowsSel.enter().append('tr');
  // Last quarter
  rowsEnter.append('td').attr('class','num last-quarter');
  // Now
  rowsEnter.append('td').attr('class','num now');
  // Delta
  rowsEnter.append('td').attr('class','num delta');
  // Diagnose
  rowsEnter.append('td').attr('class','diag');
  const merged = rowsEnter.merge(rowsSel);
  merged.select('td.last-quarter').text(d => d.lastQuarter ? `${fmt(d.lastQuarter.value)}` : '—');
  merged.select('td.now').text(d => d.now ? `${fmt(d.now.value)}` : '—');
  merged.select('td.delta').html(d => {
    if (d.delta == null) return '—';
    const up = d.delta > 0;
    const down = d.delta < 0;
    // Revert to filled triangle glyphs ▲ / ▼ for clearer visual
    const arrow = up ? '▲' : (down ? '▼' : '');
    const cls = up ? 'arrow-up' : (down ? 'arrow-down' : '');
    const prevVal = d.lastQuarter ? d.lastQuarter.value : null;
    let pctHtml = '';
    if (prevVal && prevVal !== 0) {
      const pct = Math.round(Math.abs(d.delta / prevVal * 100));
      pctHtml = ` (<span class="pct">${pct}%</span>)`;
    }
    return `<span class="delta-wrap"><span class="value">${fmt(Math.abs(d.delta))}</span>${pctHtml}${arrow ? ` <span class="arrow ${cls} diag-${d.diagnose}">${arrow}</span>` : ''}</span>`;
  });
  merged.select('td.diag').html(d => `<span class="diag-dot diag-${d.diagnose}"></span>`);
  rowsSel.exit().remove();

  // Compute diagnose color per tab independently (based on its own latest vs previous values)
  tabs.selectAll('.tab').each(function(d){
    const key = d.key;
    const chronological = [];
    for (const y of years) for (const q of quarters) chronological.push({ y, q });
    chronological.sort((a,b)=> a.y - b.y || quarters.indexOf(a.q) - quarters.indexOf(b.q));
    const vals = [];
    for (const step of chronological){
      const v = byYQK.get(`${step.y}-${step.q}-${key}`);
      if (v != null) vals.push({ y: step.y, q: step.q, v });
    }
    let color = 'yellow';
    if (vals.length >= 2){
      color = computeDiagnosis(vals[vals.length-2].v, vals[vals.length-1].v);
    }
    d3.select(this)
      .classed('diag-yellow', color === 'yellow')
      .classed('diag-red', color === 'red')
      .classed('diag-green', color === 'green');
  });

  // Ensure table width aligns with chart's inner plot width
  layoutSummary(table);

  // --- Notes section below the table ---
  let notes = summarySel.select('.notes');
  if (notes.empty()) {
    notes = summarySel.append('div').attr('class', 'notes');
  }
  // Title (single)
  const titleSel = notes.select('.notes-title');
  (titleSel.empty() ? notes.append('div').attr('class','notes-title') : titleSel)
    .html('<strong>Common Causes and Recommendations</strong>');
  // Remove any previous grouped layout and ensure a single list of 6 items
  notes.selectAll('.notes-groups,.notes-group').remove();
  const noteItems = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Quisque sagittis, velit at euismod efficitur, velit justo porta lectus, a pharetra dui nisl non urna.',
    'Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec sed odio dui. Cras mattis consectetur purus sit amet fermentum, et tempus felis interdum.',
    'Curabitur blandit tempus porttitor. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus. Vestibulum id ligula porta felis euismod semper.',
    'Etiam porta sem malesuada magna mollis euismod. Nulla vitae elit libero, a pharetra augue. Morbi leo risus, porta ac consectetur ac, vestibulum at eros.',
    'Nullam id dolor id nibh ultricies vehicula ut id elit. Donec ullamcorper nulla non metus auctor fringilla. Praesent commodo cursus magna, vel scelerisque nisl consectetur et.',
    'Maecenas faucibus mollis interdum. Donec ullamcorper nulla non metus auctor fringilla. Sed posuere consectetur est at lobortis, sed posuere mi tristique.'
  ];
  const ul = (notes.select('ul').empty() ? notes.append('ul') : notes.select('ul'));
  const li = ul.selectAll('li').data(noteItems);
  li.enter().append('li').merge(li).text(d => d);
  li.exit().remove();
  // Align notes width with chart's inner plot width
  layoutSummary(notes);
  }

  draw();

  // Re-layout summary on resize
  window.addEventListener('resize', () => {
    const tbl = d3.select('#summary').select('table');
  layoutSummary(tbl);
  const nts = d3.select('#summary').select('.notes');
  layoutSummary(nts);
  });
})();
