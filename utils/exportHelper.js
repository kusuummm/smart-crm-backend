const ExcelJS = require('exceljs');

// Builds an .xlsx buffer from an array of column defs and row objects.
// columns: [{ header: 'Name', key: 'name', width: 20 }, ...]
const buildExcelBuffer = async (sheetName, columns, rows) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));
  return workbook.xlsx.writeBuffer();
};

// Builds a CSV string from an array of column defs and row objects.
// Handles basic escaping for commas, quotes, and newlines.
const buildCsv = (columns, rows) => {
  const escape = (value) => {
    const str = value === undefined || value === null ? '' : String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map((c) => escape(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(','));
  return [header, ...lines].join('\n');
};

module.exports = { buildExcelBuffer, buildCsv };
