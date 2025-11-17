#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DAYS = 365;
const DEFAULT_OUTPUT = 'tcbs-data.csv';

function parseArgs(rawArgs) {
  const args = [...rawArgs];
  let output = DEFAULT_OUTPUT;
  let days = DEFAULT_DAYS;
  const symbols = [];

  while (args.length) {
    const arg = args.shift();
    if (arg === '--output' || arg === '-o') {
      output = args.shift();
      if (!output) throw new Error('Thiếu tên file sau --output');
    } else if (arg === '--days' || arg === '-d') {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value <= 0) throw new Error('Giá trị --days phải là số dương');
      days = Math.floor(value);
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else {
      symbols.push(arg.toUpperCase());
    }
  }

  return { output, days, symbols, help: false };
}

function showHelp() {
  console.log(`Sử dụng: node scripts/tcbs-stock-cli.mjs [tùy chọn] <mã 1> <mã 2> ...

Tuỳ chọn:
  -o, --output <file>   Tên file CSV xuất ra (mặc định: ${DEFAULT_OUTPUT})
  -d, --days <số ngày>  Khoảng thời gian lấy dữ liệu tính từ hôm nay (mặc định: ${DEFAULT_DAYS})
  -h, --help            Hiển thị trợ giúp

Ví dụ:
  node scripts/tcbs-stock-cli.mjs -o data.csv -d 180 FPT VNM VCB`);
}

function toDateString(timestampSeconds) {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

async function fetchBars(symbol, days) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fromSeconds = nowSeconds - days * 24 * 60 * 60;
  const url = `https://apipubaws.tcbs.com.vn/stock-insight/v1/stock/bars/${encodeURIComponent(symbol)}?type=stock&resolution=1D&from=${fromSeconds}&to=${nowSeconds}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`TCBS trả về lỗi ${response.status} cho mã ${symbol}`);

  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  if (!items.length) throw new Error(`Không có dữ liệu cho mã ${symbol}`);

  return items.map((item) => ({
    symbol,
    date: toDateString(item.t),
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c,
    volume: item.v,
  }));
}

function calculateStats(rows) {
  const closes = rows.map((row) => Number(row.close)).filter((value) => Number.isFinite(value));
  const count = closes.length;
  if (!count) return { count: 0, mean: NaN, std: NaN, min: NaN, max: NaN };

  const mean = closes.reduce((sum, value) => sum + value, 0) / count;
  const variance = closes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const std = Math.sqrt(variance);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  return { count, mean, std, min, max };
}

function printStats(symbol, stats) {
  console.log(`\nThống kê ${symbol}:`);
  console.log(`  Count: ${stats.count}`);
  console.log(`  Mean : ${stats.mean.toFixed(2)}`);
  console.log(`  Std  : ${stats.std.toFixed(2)}`);
  console.log(`  Min  : ${stats.min.toFixed(2)}`);
  console.log(`  Max  : ${stats.max.toFixed(2)}`);
}

function saveCsv(fileName, rows) {
  const header = 'symbol,date,open,high,low,close,volume';
  const csvLines = rows.map((row) =>
    [row.symbol, row.date, row.open, row.high, row.low, row.close, row.volume]
      .map((value) => (value ?? ''))
      .join(',')
  );
  const csv = [header, ...csvLines].join('\n');
  const filePath = path.resolve(process.cwd(), fileName);
  fs.writeFileSync(filePath, csv, 'utf8');
  return filePath;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (options.help) {
    showHelp();
    return;
  }

  if (!options.symbols.length) {
    console.error('Vui lòng nhập ít nhất một mã cổ phiếu.');
    showHelp();
    process.exit(1);
  }

  const allRows = [];
  for (const symbol of options.symbols) {
    try {
      const rows = await fetchBars(symbol, options.days);
      allRows.push(...rows);
      printStats(symbol, calculateStats(rows));
    } catch (error) {
      console.error(`Lỗi với mã ${symbol}:`, error.message);
    }
  }

  if (!allRows.length) {
    console.error('Không có dữ liệu để ghi CSV.');
    process.exit(1);
  }

  const savedPath = saveCsv(options.output, allRows);
  console.log(`\nĐã lưu ${allRows.length} dòng vào ${savedPath}`);
}

main();
